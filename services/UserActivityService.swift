import FirebaseAuth
import FirebaseFirestore
import FirebaseAnalytics
import Combine
import AuthenticationServices
import CryptoKit
import UIKit

final class UserActivityService: NSObject {
	// ─────────── Core ───────────
	private let auth = Auth.auth()
	private let db   = Firestore.firestore()
	private var authHandle: AuthStateDidChangeListenerHandle?
	private var currentUserId: String? { auth.currentUser?.uid }
	
	private var globalProps: [String: Any?] = [
		"app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
		"app_build"  : Bundle.main.infoDictionary?["CFBundleVersion"] as? String
	]
	
	private var appleReauthHelper: AppleReauthHelper?
	
	override init() {
		super.init()
		authHandle = auth.addStateDidChangeListener { _, user in
			if let user {
				Analytics.setUserID(user.uid)
				self.log(.userLoginLinked(userId: user.uid))
			} else {
				Analytics.setUserID(nil)
				self.log(.userLogoutUnlinked)
			}
		}
	}
	
	deinit {
		if let h = authHandle { auth.removeStateDidChangeListener(h) }
	}
	
	// ─────────── Launch/user props ───────────
	func configureForLaunch(appRole: String?, locale: String?) {
		if let role = appRole, !role.isEmpty { Analytics.setUserProperty(role, forName: "app_role") }
		if let loc  = locale,  !loc.isEmpty  { Analytics.setUserProperty(loc,  forName: "locale") }
	}
	
	// ─────────── Onboarding ───────────
	func updateOnboardedStatus() -> AnyPublisher<Void, Error> {
		guard let userId = currentUserId else {
			return Fail(error: NSError(
				domain: "UserActivityService",
				code: 0,
				userInfo: [NSLocalizedDescriptionKey: "User not logged in"]
			)).eraseToAnyPublisher()
		}
		
		return Future { promise in
			self.db.collection("users").document(userId)
				.updateData(["onboarded": true]) { error in
					if let error = error {
						self.log(.onboardingUpdateError(message: error.localizedDescription))
						promise(.failure(error))
					} else {
						self.log(.onboardingUpdateSuccess)
						promise(.success(()))
					}
				}
		}
		.eraseToAnyPublisher()
	}
	
	// ─────────── Roles ───────────
	func isUserAdmin(completion: @escaping (Bool) -> Void) {
		guard let userId = currentUserId else { completion(false); return }
		db.collection("users").document(userId).getDocument { document, _ in
			if let document, document.exists {
				let role = document.data()?["role"] as? String
				completion(role == "admin")
			} else {
				completion(false)
			}
		}
	}
	
	// ─────────── Delete account (conventional client-side) ───────────
	func deleteAccount() -> AnyPublisher<Void, Error> {
		guard let user = auth.currentUser else {
			return Fail(error: NSError(
				domain: "UserActivityService",
				code: 0,
				userInfo: [NSLocalizedDescriptionKey: "User not logged in"]
			)).eraseToAnyPublisher()
		}
		let uid = user.uid
		
		return Future { promise in
			self.deleteUserDocument(uid: uid) { _ in
				self.tryAuthDelete(uid: uid) { result in
					switch result {
					case .success:
						self.finishSignOut()
						promise(.success(()))
					case .failure(let err as NSError):
						if self.isRequiresRecentLogin(err) {
							DispatchQueue.main.async {
								self.reauthenticateWithApple { reauth in
									switch reauth {
									case .failure(let e):
										self.log(.profileDeleteAccountError(message: e.localizedDescription))
										promise(.failure(e))
									case .success:
										self.tryAuthDelete(uid: uid) { final in
											switch final {
											case .success:
												self.finishSignOut()
												promise(.success(()))
											case .failure(let finalErr):
												self.log(.profileDeleteAccountError(message: finalErr.localizedDescription))
												promise(.failure(finalErr))
											}
										}
									}
								}
							}
						} else {
							self.log(.profileDeleteAccountError(message: err.localizedDescription))
							promise(.failure(err))
						}
					default:
						let u = NSError(domain: "UserActivityService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unknown delete error"])
						self.log(.profileDeleteAccountError(message: u.localizedDescription))
						promise(.failure(u))
					}
				}
			}
		}
		.eraseToAnyPublisher()
	}
	
	// ─────────── Firestore audit (lightweight) ───────────
	func logAction(actionType: String, topicId: String, cardId: String? = nil) {
		guard let userId = currentUserId else { return }
		var data: [String: Any] = [
			"userID": userId,
			"topicID": topicId,
			"actionType": actionType,
			"timestamp": Timestamp(date: Date())
		]
		if let cardId { data["cardID"] = cardId }
		db.collection("userActions").addDocument(data: data) { _ in }
	}
	
	// ─────────── Reads (product state) ───────────
	func markCardRead(cardId: String,
					  topicId: String,
					  readTrigger: String,
					  dwellMs: Int,
					  completion: ((Error?) -> Void)? = nil) {
		guard let userId = currentUserId else {
			completion?(NSError(
				domain: "UserActivityService",
				code: 0,
				userInfo: [NSLocalizedDescriptionKey: "User not logged in"]
			))
			return
		}
		let data: [String: Any] = [
			"readAt": Timestamp(date: Date()),
			"topicId": topicId,
			"readTrigger": readTrigger,
			"dwellMs": dwellMs
		]
		db.collection("users")
			.document(userId)
			.collection("cardReads")
			.document(cardId)
			.setData(data, merge: true) { error in
				completion?(error)
			}
	}
	
	// ─────────── Typed analytics API ───────────
	enum Event {
		case userLoginLinked(userId: String)
		case userLogoutUnlinked
		case onboardingUpdateSuccess
		case onboardingUpdateError(message: String)
		case profileDeleteAccountSuccess
		case profileDeleteAccountError(message: String)
		case custom(name: String, params: [String: Any?])
	}
	
	func log(_ e: Event) {
		switch e {
		case .userLoginLinked(let userId):      logEvent("user_login_linked",      ["user_id": userId])
		case .userLogoutUnlinked:               logEvent("user_logout_unlinked",   nil)
		case .onboardingUpdateSuccess:          logEvent("onboarding_update_success", nil)
		case .onboardingUpdateError(let msg):   logEvent("onboarding_update_error", ["message": msg])
		case .profileDeleteAccountSuccess:      logEvent("profile_delete_account_success", nil)
		case .profileDeleteAccountError(let m): logEvent("profile_delete_account_error",   ["message": m])
		case .custom(let name, let params):     logEvent(name, params)
		}
	}
}

// MARK: - Delete plumbing
private extension UserActivityService {
	func deleteUserDocument(uid: String, completion: @escaping (Bool) -> Void) {
		let userRef = db.collection("users").document(uid)
		
		deleteCardReads(for: uid) { _ in
			userRef.delete { err in
				if let err = err {
					self.log(.custom(name: "user_doc_delete_error", params: [
						"message": err.localizedDescription
					]))
					completion(false)
				} else {
					self.log(.custom(name: "user_doc_delete_success", params: [:]))
					completion(true)
				}
			}
		}
	}
	
	func deleteCardReads(for uid: String, completion: @escaping (Bool) -> Void) {
		let readsRef = db.collection("users").document(uid).collection("cardReads")
		
		readsRef.getDocuments { snapshot, error in
			if let error = error {
				self.log(.custom(name: "user_card_reads_fetch_error", params: [
					"message": error.localizedDescription
				]))
				completion(false)
				return
			}
			
			guard let docs = snapshot?.documents, !docs.isEmpty else {
				self.log(.custom(name: "user_card_reads_empty", params: [:]))
				completion(true)
				return
			}
			
			let batch = self.db.batch()
			for doc in docs {
				batch.deleteDocument(doc.reference)
			}
			
			batch.commit { err in
				if let err = err {
					self.log(.custom(name: "user_card_reads_delete_error", params: [
						"message": err.localizedDescription
					]))
					completion(false)
				} else {
					self.log(.custom(name: "user_card_reads_delete_success", params: [
						"count": docs.count
					]))
					completion(true)
				}
			}
		}
	}
	
	func tryAuthDelete(uid: String, completion: @escaping (Result<Void, Error>) -> Void) {
		auth.currentUser?.delete { err in
			if let err = err { completion(.failure(err)); return }
			self.log(.profileDeleteAccountSuccess)
			completion(.success(()))
		}
	}
	
	func finishSignOut() {
		_ = try? auth.signOut()
		NotificationCenter.default.post(name: .userDidLogout, object: nil)
	}
	
	func isRequiresRecentLogin(_ err: NSError) -> Bool {
		err.domain == AuthErrorDomain && err.code == AuthErrorCode.requiresRecentLogin.rawValue
	}
}

// MARK: - Apple reauth (only if required)
private extension UserActivityService {
	func reauthenticateWithApple(completion: @escaping (Result<Void, Error>) -> Void) {
		guard let user = auth.currentUser else {
			completion(.failure(NSError(domain: "UserActivityService", code: 0, userInfo: [NSLocalizedDescriptionKey: "No user"])))
			return
		}
		let usesApple = user.providerData.contains { $0.providerID == "apple.com" }
		guard usesApple else { completion(.success(())); return }
		
		appleReauthHelper = AppleReauthHelper { [weak self] result in
			completion(result)
			self?.appleReauthHelper = nil
		}
		appleReauthHelper?.start()
	}
	
	final class AppleReauthHelper: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
		private let completion: (Result<Void, Error>) -> Void
		private var currentNonce: String?
		
		init(completion: @escaping (Result<Void, Error>) -> Void) {
			self.completion = completion
		}
		
		func start() {
			let request = ASAuthorizationAppleIDProvider().createRequest()
			let nonce = randomNonceString()
			currentNonce = nonce
			request.requestedScopes = []
			request.nonce = sha256(nonce)
			
			let controller = ASAuthorizationController(authorizationRequests: [request])
			controller.delegate = self
			controller.presentationContextProvider = self
			controller.performRequests()
		}
		
		func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
			guard
				let apple = authorization.credential as? ASAuthorizationAppleIDCredential,
				let tokenData = apple.identityToken,
				let token     = String(data: tokenData, encoding: .utf8),
				let nonce     = currentNonce,
				let user      = Auth.auth().currentUser
			else {
				return completion(.failure(NSError(domain: "Reauth", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid Apple credential"])))
			}
			let cred = OAuthProvider.credential(withProviderID: "apple.com", idToken: token, rawNonce: nonce)
			user.reauthenticate(with: cred) { _, error in
				if let error { self.completion(.failure(error)) }
				else { self.completion(.success(())) }
			}
		}
		
		func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
			completion(.failure(error))
		}
		
		func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
			if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
			   let win = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first {
				return win
			}
			return UIWindow()
		}
	}
}

// MARK: - Nonce/hash utils
private func sha256(_ input: String) -> String {
	let inputData = Data(input.utf8)
	let hashed = SHA256.hash(data: inputData)
	return hashed.compactMap { String(format: "%02x", $0) }.joined()
}

private func randomNonceString(length: Int = 32) -> String {
	precondition(length > 0)
	let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
	var result = ""
	var remaining = length
	while remaining > 0 {
		var bytes = [UInt8](repeating: 0, count: 16)
		let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
		if status != errSecSuccess { fatalError("SecRandomCopyBytes failed: \(status)") }
		for b in bytes where remaining > 0 {
			if b < charset.count {
				result.append(charset[Int(b)])
				remaining -= 1
			}
		}
	}
	return result
}

// MARK: - Analytics helper
private extension UserActivityService {
	func logEvent(_ name: String, _ params: [String: Any?]?) {
		var merged = globalProps
		if let params { for (k, v) in params { merged[k] = v } }
		
		var out: [String: NSObject] = [:]
		for (k, v) in merged {
			guard let v else { continue }
			switch v {
			case let s as String: out[k] = s as NSString
			case let b as Bool:   out[k] = NSNumber(value: b)
			case let i as Int:    out[k] = NSNumber(value: i)
			case let d as Double: out[k] = NSNumber(value: d)
			case let f as Float:  out[k] = NSNumber(value: f)
			case let ns as NSString: out[k] = ns
			case let num as NSNumber: out[k] = num
			default: continue
			}
		}
		Analytics.logEvent(name, parameters: out.isEmpty ? nil : out)
	}
}
