import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/**
 * Automated architecture rules (ADR-0001, SYSTEM_ARCHITECTURE §3):
 *  1. A module imports another module only through that module's index.ts.
 *  2. The module dependency graph matches the documented, acyclic graph.
 *  3. domain/ code imports no framework, driver or infrastructure code.
 *  4. SQL writes (INSERT/UPDATE/DELETE) touch only tables owned by the module containing them.
 *  5. Platform and shared code never depend on business modules.
 *  6. Route parameters and queries are validated through ZodParams/ZodQuery, which also put
 *     them in the OpenAPI contract (ADR-0014).
 */

const SRC = resolve(__dirname, '../../src');

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

/** "modules/mobility", "platform/audit", "shared", "infrastructure", "config", or "root". */
function unitOf(file: string): string {
  const parts = relative(SRC, file).split(sep);
  if ((parts[0] === 'modules' || parts[0] === 'platform') && parts.length > 2)
    return `${parts[0]}/${parts[1]}`;
  if (parts.length > 1) return parts[0]!;
  return 'root';
}

interface ImportEdge {
  readonly from: string;
  readonly specifier: string;
  readonly resolved: string | null;
}

function importsOf(file: string): ImportEdge[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );
  const edges: ImportEdge[] = [];
  source.forEachChild((node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const resolved = specifier.startsWith('.')
        ? resolveTs(resolve(dirname(file), specifier))
        : null;
      edges.push({ from: file, specifier, resolved });
    }
  });
  return edges;
}

function resolveTs(base: string): string {
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try next
    }
  }
  return base;
}

const FILES = listFiles(SRC);
const EDGES = FILES.flatMap(importsOf);
const isBusinessModule = (unit: string) => unit.startsWith('modules/');
const isPlatform = (unit: string) => unit.startsWith('platform/');

/** The documented dependency graph between business modules. Platform/shared are always allowed. */
const ALLOWED_MODULE_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  'modules/identity': [],
  'modules/health': [],
  'modules/geography': [],
  'modules/fleet': [],
  'modules/drivers': ['modules/identity', 'modules/fleet', 'modules/geography'],
  'modules/finance': ['modules/geography'],
  'modules/pricing': ['modules/geography', 'modules/finance'],
  'modules/mobility': [
    'modules/identity',
    'modules/pricing',
    'modules/drivers',
    'modules/fleet',
    'modules/finance',
    'modules/geography',
  ],
  'modules/notifications': ['modules/identity'],
};

/** Table write ownership (SYSTEM_ARCHITECTURE §3 and DATABASE_DESIGN). */
const TABLE_OWNERS: Readonly<Record<string, string>> = {
  users: 'modules/identity',
  user_roles: 'modules/identity',
  service_areas: 'modules/geography',
  service_area_services: 'modules/geography',
  vehicle_types: 'modules/fleet',
  service_types: 'modules/fleet',
  service_vehicle_compatibility: 'modules/fleet',
  vehicles: 'modules/fleet',
  drivers: 'modules/drivers',
  driver_locations: 'modules/drivers',
  driver_documents: 'modules/drivers',
  fare_policies: 'modules/pricing',
  fare_quotes: 'modules/pricing',
  commission_policies: 'modules/finance',
  ride_payments: 'modules/finance',
  ledger_transactions: 'modules/finance',
  ledger_entries: 'modules/finance',
  rides: 'modules/mobility',
  ride_offers: 'modules/mobility',
  fare_agreements: 'modules/mobility',
  ride_assignments: 'modules/mobility',
  device_registrations: 'modules/notifications',
  audit_events: 'platform/audit',
  outbox_events: 'platform/outbox',
  idempotency_keys: 'platform/idempotency',
};

describe('architecture', () => {
  it('finds the source tree', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('imports other modules only through their public index.ts', () => {
    const violations = EDGES.filter((e) => {
      if (!e.resolved) return false;
      const fromUnit = unitOf(e.from);
      const toUnit = unitOf(e.resolved);
      if (fromUnit === toUnit) return false;
      if (!isBusinessModule(toUnit) && !isPlatform(toUnit)) return false;
      if (toUnit === 'platform/workers') return false; // shared worker base class
      return !e.resolved.endsWith(join(toUnit.replace('/', sep), 'index.ts'));
    }).map((e) => `${relative(SRC, e.from)} -> ${e.specifier}`);
    expect(violations).toEqual([]);
  });

  it('follows the documented module dependency graph (which is acyclic)', () => {
    const actual = new Map<string, Set<string>>();
    for (const e of EDGES) {
      if (!e.resolved) continue;
      const fromUnit = unitOf(e.from);
      const toUnit = unitOf(e.resolved);
      if (fromUnit !== toUnit && isBusinessModule(fromUnit) && isBusinessModule(toUnit)) {
        actual.set(fromUnit, (actual.get(fromUnit) ?? new Set()).add(toUnit));
      }
    }
    const unexpected: string[] = [];
    for (const [from, targets] of actual) {
      for (const to of targets) {
        if (!(ALLOWED_MODULE_DEPENDENCIES[from] ?? []).includes(to))
          unexpected.push(`${from} -> ${to}`);
      }
    }
    expect(unexpected).toEqual([]);

    // The allowed graph itself must be acyclic.
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (node: string, path: string[]): void => {
      if (done.has(node)) return;
      if (visiting.has(node)) throw new Error(`cycle: ${[...path, node].join(' -> ')}`);
      visiting.add(node);
      for (const next of ALLOWED_MODULE_DEPENDENCIES[node] ?? []) visit(next, [...path, node]);
      visiting.delete(node);
      done.add(node);
    };
    for (const node of Object.keys(ALLOWED_MODULE_DEPENDENCIES)) visit(node, []);
  });

  it('keeps platform, shared and infrastructure code independent of business modules', () => {
    const violations = EDGES.filter((e) => {
      if (!e.resolved) return false;
      const fromUnit = unitOf(e.from);
      return (
        (isPlatform(fromUnit) || ['shared', 'infrastructure', 'config'].includes(fromUnit)) &&
        isBusinessModule(unitOf(e.resolved))
      );
    }).map((e) => `${relative(SRC, e.from)} -> ${e.specifier}`);
    expect(violations).toEqual([]);
  });

  it('keeps domain code free of framework, driver and infrastructure imports', () => {
    const violations = EDGES.filter((e) => {
      if (!relative(SRC, e.from).split(sep).includes('domain')) return false;
      if (/^(@nestjs\/|pg$|jose$|@supabase\/|google-auth-library$)/.test(e.specifier)) return true;
      return (
        e.resolved !== null &&
        /[/\\](infrastructure|application|http)[/\\]/.test(relative(SRC, e.resolved))
      );
    }).map((e) => `${relative(SRC, e.from)} -> ${e.specifier}`);
    expect(violations).toEqual([]);
  });

  it('writes only to tables owned by the module containing the SQL', () => {
    const violations: string[] = [];
    const writePattern = /\b(?:insert\s+into|update|delete\s+from)\s+taketuk\.([a-z_]+)/gi;
    for (const file of FILES) {
      const unit = unitOf(file);
      if (!isBusinessModule(unit) && !isPlatform(unit)) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(writePattern)) {
        const table = match[1]!.toLowerCase();
        const owner = TABLE_OWNERS[table];
        if (owner !== unit)
          violations.push(`${relative(SRC, file)} writes ${table} (owner: ${owner ?? 'unknown'})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('validates route parameters and queries only through the documenting decorators', () => {
    const violations = FILES.filter((file) => unitOf(file) !== 'shared')
      .filter((file) => /\bvalid(?:Param|Query)\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(violations).toEqual([]);
  });
});
