import 'dart:async';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:taketuk_api/taketuk_api.dart';

/// Documents the backend requires before a driver can submit (backend `REQUIRED_*_DOCUMENTS`,
/// OPEN_DECISIONS DRV-1). Mirrored here only to show a checklist: the server decides, and
/// answers `VERIFICATION_REQUIREMENTS_NOT_MET` when something is missing.
const requiredDriverDocuments = [
  DriverDocumentDocumentType.driverPhoto,
  DriverDocumentDocumentType.drivingLicense,
  DriverDocumentDocumentType.nationalId,
];
const requiredVehicleDocuments = [
  DriverDocumentDocumentType.vehicleRegistration,
  DriverDocumentDocumentType.vehiclePhoto,
];

enum PhotoSource { camera, gallery }

final class PickedDocument {
  const PickedDocument({required this.bytes, required this.contentType});

  final Uint8List bytes;
  final DriversRequestDocumentUploadRequestContentType contentType;
}

/// Picks a document photo. Behind an interface so screens can be tested without a device.
abstract interface class DocumentPicker {
  /// Null when the driver backs out.
  Future<PickedDocument?> pick(PhotoSource source);
}

final class ImagePickerDocumentPicker implements DocumentPicker {
  const ImagePickerDocumentPicker();

  @override
  Future<PickedDocument?> pick(PhotoSource source) async {
    // Downscaled and recompressed: legible for review, small enough for slow networks.
    final file = await ImagePicker().pickImage(
      source: source == PhotoSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 80,
    );
    if (file == null) return null;
    final png = (file.mimeType ?? file.name).toLowerCase().endsWith('png');
    return PickedDocument(
      bytes: await file.readAsBytes(),
      contentType: png
          ? DriversRequestDocumentUploadRequestContentType.imagePng
          : DriversRequestDocumentUploadRequestContentType.imageJpeg,
    );
  }
}

/// Uploads one document: a signed upload URL from the API, the bytes straight to storage, then
/// the confirmation, which the API accepts only once the object exists (ADR-0006: the apps use
/// storage only through URLs the backend issues).
Future<DriverDocument> uploadDocument({
  required TaketukApi api,
  required http.Client storage,
  required DriverDocumentDocumentType type,
  required PickedDocument file,
  String? vehicleId,
}) async {
  final grant = await api.drivers.requestDocumentUpload(
    DriversRequestDocumentUploadRequest(
      documentType: DriversRequestDocumentUploadRequestDocumentType.fromJson(
        type.value,
      ),
      contentType: file.contentType,
      vehicleId: vehicleId,
    ),
  );
  final http.Response response;
  try {
    response = await storage
        .put(
          Uri.parse(grant.upload.url),
          headers: grant.upload.headers,
          body: file.bytes,
        )
        .timeout(const Duration(seconds: 90));
  } on TimeoutException catch (error) {
    throw ApiUnavailable('document upload timed out', cause: error);
  } on http.ClientException catch (error) {
    throw ApiUnavailable('document upload failed', cause: error);
  }
  if (response.statusCode >= 300) {
    throw ApiUnavailable(
      'storage answered HTTP ${response.statusCode}',
      reachedServer: true,
    );
  }
  return api.drivers.confirmDocumentUpload(grant.document.id);
}
