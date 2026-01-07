import FirebaseFirestore
import FirebaseAuth
import Combine

class NotificationsService {
	private let db = Firestore.firestore()
	
	private var currentUserId: String? {
		return Auth.auth().currentUser?.uid
	}
	
	func isNotificationsEnabled() -> AnyPublisher<Bool, Error> {
		guard let userId = currentUserId else {
			return Fail(error: NSError(domain: "UserService", code: 0,
									   userInfo: [NSLocalizedDescriptionKey: "User not logged in"]))
			.eraseToAnyPublisher()
		}
		return Future { promise in
			self.db.collection("users").document(userId).getDocument { document, error in
				if let document = document, document.exists {
					let data = document.data() ?? [:]
					let enabled = data["notificationsEnabled"] as? Bool ?? false
					promise(.success(enabled))
				} else {
					promise(.failure(error ?? NSError(domain: "Document does not exist", code: 0)))
				}
			}
		}
		.eraseToAnyPublisher()
	}
	
	func updateNotificationsEnabled(isEnabled: Bool) -> AnyPublisher<Void, Error> {
		guard let userId = currentUserId else {
			return Fail(error: NSError(domain: "UserService", code: 0,
									   userInfo: [NSLocalizedDescriptionKey: "User not logged in"]))
			.eraseToAnyPublisher()
		}
		return Future { promise in
			self.db.collection("users").document(userId)
				.updateData(["notificationsEnabled": isEnabled]) { error in
					if let error = error {
						promise(.failure(error))
					} else {
						promise(.success(()))
					}
				}
		}
		.eraseToAnyPublisher()
	}
	
	// ─────────── Push Token ───────────
	func upsertFcmToken(token: String,
						apnsEnvironment: String,
						appVersion: String,
						deviceId: String? = nil) -> AnyPublisher<Void, Error> {
		guard let userId = currentUserId else {
			return Fail(error: NSError(domain: "UserService", code: 0,
									   userInfo: [NSLocalizedDescriptionKey: "User not logged in"]))
			.eraseToAnyPublisher()
		}
		let ref = db.collection("users").document(userId).collection("fcmTokens").document(token)
		var data: [String: Any] = [
			"platform": "ios",
			"apnsEnvironment": apnsEnvironment,
			"appVersion": appVersion,
			"lastSeen": FieldValue.serverTimestamp(),
			"enabled": true
		]
		if let deviceId = deviceId, !deviceId.isEmpty {
			data["deviceId"] = deviceId
		}
		return Future { promise in
			ref.setData(data, merge: true) { error in
				if let error = error {
					promise(.failure(error))
				} else {
					promise(.success(()))
				}
			}
		}
		.eraseToAnyPublisher()
	}
	
	// ─────────── Time Preferences ───────────
	func updateNotificationTimePreferences(timezoneIdentifier: String,
										   tzOffsetMinutes: Int,
										   preferredPushMinutes: [Int]) -> AnyPublisher<Void, Error> {
		guard let userId = currentUserId else {
			return Fail(error: NSError(domain: "UserService", code: 0,
									   userInfo: [NSLocalizedDescriptionKey: "User not logged in"]))
			.eraseToAnyPublisher()
		}
		let doc: [String: Any] = [
			"tzIdentifier": timezoneIdentifier,
			"tzOffsetMinutes": tzOffsetMinutes,
			"preferredPushMinutes": preferredPushMinutes
		]
		return Future { promise in
			self.db.collection("users").document(userId).setData(doc, merge: true) { error in
				if let error = error {
					promise(.failure(error))
				} else {
					promise(.success(()))
				}
			}
		}
		.eraseToAnyPublisher()
	}
}
