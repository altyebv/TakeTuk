import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

/// Wad Madani city centre: the initial view until the device position is known.
const LatLng wadMadaniCentre = LatLng(14.4012, 33.5199);

/// Map display settings from the build configuration (OPEN_DECISIONS MAP-6: flutter_map with
/// OpenStreetMap-based maps).
@immutable
final class MapSettings {
  const MapSettings({
    required this.tileUrlTemplate,
    required this.attribution,
    required this.userAgentPackageName,
  });

  /// Settings that draw no map images, only markers: for tests and when no provider is set.
  const MapSettings.withoutTiles()
    : tileUrlTemplate = null,
      attribution = '© OpenStreetMap contributors',
      userAgentPackageName = 'app.taketuk';

  /// For example `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Null draws no tiles.
  final String? tileUrlTemplate;

  /// Shown on every map, as the data licence requires (OPEN_DECISIONS MAP-2).
  final String attribution;

  /// Identifies the app to the tile server, as tile usage policies require.
  final String userAgentPackageName;
}

/// A map pin for a trip point.
Marker tripMarker(
  LatLng point, {
  required Color color,
  required String label,
  Key? key,
}) => Marker(
  key: key,
  point: point,
  width: 48,
  height: 48,
  alignment: Alignment.topCenter,
  child: Semantics(
    label: label,
    child: Icon(Icons.location_on, color: color, size: 48),
  ),
);

/// The shared map: tiles from [MapSettings], the given markers and the attribution.
class TaketukMap extends StatelessWidget {
  const TaketukMap({
    required this.settings,
    this.markers = const [],
    this.initialCenter = wadMadaniCentre,
    this.initialZoom = 14,
    this.onTap,
    this.controller,
    super.key,
  });

  final MapSettings settings;
  final List<Marker> markers;
  final LatLng initialCenter;
  final double initialZoom;
  final void Function(LatLng point)? onTap;
  final MapController? controller;

  @override
  Widget build(BuildContext context) => FlutterMap(
    mapController: controller,
    options: MapOptions(
      initialCenter: initialCenter,
      initialZoom: initialZoom,
      minZoom: 5,
      maxZoom: 18,
      interactionOptions: const InteractionOptions(
        flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
      ),
      onTap: onTap == null ? null : (_, point) => onTap!(point),
    ),
    children: [
      if (settings.tileUrlTemplate case final url?)
        TileLayer(
          urlTemplate: url,
          userAgentPackageName: settings.userAgentPackageName,
        ),
      MarkerLayer(markers: markers),
      RichAttributionWidget(
        attributions: [TextSourceAttribution(settings.attribution)],
      ),
    ],
  );
}
