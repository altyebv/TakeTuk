import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

/// The device's position. Behind an interface so screens can be tested without a device.
abstract interface class DeviceLocation {
  /// The current position, or null when location is off, permission is refused, or no fix
  /// arrives in time. Asks for permission when it has not been decided yet.
  Future<LatLng?> current();
}

final class GeolocatorDeviceLocation implements DeviceLocation {
  const GeolocatorDeviceLocation();

  @override
  Future<LatLng?> current() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return null;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      return LatLng(position.latitude, position.longitude);
    } on Exception {
      // Timeouts and platform errors: the user places the point on the map instead.
      return null;
    }
  }
}
