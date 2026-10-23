import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import '../driver_text.dart';
import '../l10n/driver_localizations.dart';
import 'documents.dart';

/// Applicants (and rejected drivers fixing their application): documents, vehicle, then
/// submission for review (STATE_MACHINES §6).
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({
    required this.api,
    required this.profile,
    required this.picker,
    required this.storage,
    required this.onSubmitted,
    super.key,
  });

  final TaketukApi api;
  final DriverProfile profile;
  final DocumentPicker picker;

  /// HTTP client for the signed storage uploads.
  final http.Client storage;
  final void Function(DriverProfile profile) onSubmitted;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  List<Vehicle> _vehicles = const [];
  List<DriverDocument> _documents = const [];
  List<FleetListVehicleTypesResponseItemsItem> _vehicleTypes = const [];
  bool _loaded = false;
  String? _uploading;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final vehicles = await widget.api.drivers.listVehicles();
      final documents = await widget.api.drivers.listDocuments();
      final types = await widget.api.fleet.listVehicleTypes();
      if (!mounted) return;
      setState(() {
        _vehicles = vehicles.items;
        _documents = documents.items;
        _vehicleTypes = types.items;
        _loaded = true;
        _error = null;
      });
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  bool _uploaded(DriverDocumentDocumentType type, {String? vehicleId}) =>
      _documents.any(
        (d) =>
            d.documentType == type &&
            d.status == DriverDocumentStatus.uploaded &&
            d.vehicleId == vehicleId,
      );

  /// The vehicle this application is for: the first one not rejected.
  Vehicle? get _vehicle =>
      _vehicles.where((v) => v.status != VehicleStatus.rejected).firstOrNull;

  bool get _complete =>
      requiredDriverDocuments.every(_uploaded) &&
      _vehicle != null &&
      requiredVehicleDocuments.every(
        (type) => _uploaded(type, vehicleId: _vehicle!.id),
      );

  Future<void> _upload(
    DriverDocumentDocumentType type, {
    String? vehicleId,
  }) async {
    final l10n = DriverLocalizations.of(context);
    final source = await showModalBottomSheet<PhotoSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera),
              title: Text(l10n.takePhoto),
              onTap: () => Navigator.pop(context, PhotoSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: Text(l10n.chooseFromGallery),
              onTap: () => Navigator.pop(context, PhotoSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    final file = await widget.picker.pick(source);
    if (file == null || !mounted) return;
    setState(() {
      _uploading = '${type.value}:$vehicleId';
      _error = null;
    });
    try {
      await uploadDocument(
        api: widget.api,
        storage: widget.storage,
        type: type,
        file: file,
        vehicleId: vehicleId,
      );
      await _load();
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  Future<void> _addVehicle() async {
    final request = await showDialog<DriversRegisterVehicleRequest>(
      context: context,
      builder: (_) => _AddVehicleDialog(types: _vehicleTypes),
    );
    if (request == null) return;
    try {
      await widget.api.drivers.registerVehicle(request);
      await _load();
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    try {
      widget.onSubmitted(await widget.api.drivers.submitForReview());
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = DriverLocalizations.of(context);
    final theme = Theme.of(context);
    if (!_loaded) {
      return Center(
        child: _error == null
            ? const CircularProgressIndicator()
            : Padding(
                padding: const EdgeInsets.all(24),
                child: ErrorMessage(_error!),
              ),
      );
    }
    final rejected = widget.profile.status == DriverProfileStatus.rejected;
    final vehicle = _vehicle;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (rejected) ...[
          Card(
            color: theme.colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.statusRejected),
                  if (widget.profile.reviewNote case final note?)
                    Text(l10n.reviewNote(note)),
                  Text(l10n.resubmitHelp),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
        Text(l10n.documentsTitle, style: theme.textTheme.titleMedium),
        for (final type in requiredDriverDocuments) _documentTile(l10n, type),
        const SizedBox(height: 16),
        Text(l10n.vehicleTitle, style: theme.textTheme.titleMedium),
        if (vehicle == null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: OutlinedButton.icon(
              onPressed: _addVehicle,
              icon: const Icon(Icons.add),
              label: Text(l10n.addVehicle),
            ),
          )
        else ...[
          ListTile(
            key: const Key('vehicle'),
            leading: const Icon(Icons.electric_rickshaw),
            title: Text(vehicle.plateNumber),
            subtitle: Text(vehicleStatusLabel(l10n, vehicle.status)),
          ),
          for (final type in requiredVehicleDocuments)
            _documentTile(l10n, type, vehicleId: vehicle.id),
        ],
        if (_error case final error?)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              driverErrorMessage(context, error),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
        const SizedBox(height: 16),
        Text(l10n.submitHelp, style: theme.textTheme.bodySmall),
        const SizedBox(height: 8),
        BusyButton(
          label: l10n.submitForReview,
          onPressed: _complete ? _submit : null,
        ),
      ],
    );
  }

  Widget _documentTile(
    DriverLocalizations l10n,
    DriverDocumentDocumentType type, {
    String? vehicleId,
  }) {
    final done = _uploaded(type, vehicleId: vehicleId);
    final busy = _uploading == '${type.value}:$vehicleId';
    return ListTile(
      key: Key('doc-${type.value}'),
      leading: Icon(
        done ? Icons.check_circle : Icons.radio_button_unchecked,
        color: done ? Colors.green.shade700 : null,
      ),
      title: Text(documentName(l10n, type)),
      subtitle: Text(done ? l10n.docUploaded : l10n.docMissing),
      trailing: busy
          ? const SizedBox.square(
              dimension: 24,
              child: CircularProgressIndicator(strokeWidth: 3),
            )
          : TextButton(
              onPressed: _uploading == null
                  ? () => _upload(type, vehicleId: vehicleId)
                  : null,
              child: Text(done ? l10n.replace : l10n.upload),
            ),
    );
  }
}

/// Vehicle details. Owns its text controllers, which must outlive the closing animation.
class _AddVehicleDialog extends StatefulWidget {
  const _AddVehicleDialog({required this.types});

  final List<FleetListVehicleTypesResponseItemsItem> types;

  @override
  State<_AddVehicleDialog> createState() => _AddVehicleDialogState();
}

class _AddVehicleDialogState extends State<_AddVehicleDialog> {
  final _plate = TextEditingController();
  final _description = TextEditingController();
  late String? _type = widget.types
      .where((t) => t.code == 'raksha')
      .map((t) => t.code)
      .followedBy(widget.types.map((t) => t.code))
      .firstOrNull;

  @override
  void dispose() {
    _plate.dispose();
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = DriverLocalizations.of(context);
    final plate = _plate.text.trim();
    return AlertDialog(
      title: Text(l10n.addVehicle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DropdownButtonFormField<String>(
            initialValue: _type,
            decoration: InputDecoration(labelText: l10n.vehicleTypeLabel),
            items: [
              for (final type in widget.types)
                DropdownMenuItem(
                  value: type.code,
                  child: Text(type.displayName),
                ),
            ],
            onChanged: (value) => setState(() => _type = value),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('plate'),
            controller: _plate,
            maxLength: 20,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(labelText: l10n.plateLabel),
            onChanged: (_) => setState(() {}),
          ),
          TextField(
            controller: _description,
            maxLength: 200,
            decoration: InputDecoration(
              labelText: l10n.vehicleDescriptionLabel,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed: _type == null || plate.length < 2
              ? null
              : () => Navigator.pop(
                  context,
                  DriversRegisterVehicleRequest(
                    vehicleTypeCode: _type!,
                    plateNumber: plate,
                    description: _description.text.trim().isEmpty
                        ? null
                        : _description.text.trim(),
                  ),
                ),
          child: Text(l10n.save),
        ),
      ],
    );
  }
}
