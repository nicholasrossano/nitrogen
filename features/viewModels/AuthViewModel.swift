import SwiftUI
import AuthenticationServices
import FirebaseAuth
import Combine
import FirebaseFirestore
import FirebaseAnalytics
import CryptoKit

extension Notification.Name {
	static let userDidAuthenticate   = Notification.Name("userDidAuthenticate")
	static let triggerOnboarding     = Notification.Name("triggerOnboarding")
	static let didCompleteOnboarding = Notification.Name("didCompleteOnboarding")
}

class AuthViewModel: NSObject, ObservableObject,
					 ASAuthorizationControllerDelegate,
					 ASAuthorizationControllerPresentationContextProviding {
	
	@Published var email = ""
	@Published var password = ""
	@Published var errorMessage: String?
	
	private let servicesLocator = AppServicesLocator.shared
	var cancellables = Set<AnyCancellable>()
	
	// ─────────── SIWA state ───────────
	private var currentNonce: String?
	private var isSigningIn = false
	
	func handleSignInWithAppleRequest(request: ASAuthorizationAppleIDRequest) {
		request.requestedScopes = [.fullName, .email]
		let nonce = randomNonceString()
		currentNonce = nonce
		request.nonce = sha256(nonce)
	}
	
	func handleSignInWithAppleCompletion(result: Result<ASAuthorization, Error>) {
		switch result {
		case .success(let authorization):
			guard !isSigningIn else { return }
			isSigningIn = true
			
			guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential else {
				finishWithError("Invalid Apple credential"); return
			}
			guard let identityToken = appleIDCredential.identityToken,
				  let identityTokenString = String(data: identityToken, encoding: .utf8) else {
				finishWithError("Unable to fetch or decode identity token"); return
			}
			guard let nonce = currentNonce else {
				finishWithError("Missing nonce; please try again"); return
			}
			
			let credential = OAuthProvider.credential(
				withProviderID: "apple.com",
				idToken: identityTokenString,
				rawNonce: nonce
			)
			
			Auth.auth().signIn(with: credential) { [weak self] (authResult, error) in
				guard let self else { return }
				self.currentNonce = nil
				self.isSigningIn = false
				
				if let error = error as NSError? {
					self.errorMessage = error.localizedDescription
					Analytics.logEvent("auth_sign_in_error", parameters: [
						"screen": "auth" as NSString,
						"message": error.localizedDescription as NSString
					])
					return
				}
				
				guard let authResult = authResult else { return }
				let user = authResult.user
				let isNewUser = (authResult.additionalUserInfo?.isNewUser == true)
				
				self.ensureLaunchDestinationPreferenceForSignedInUser(uid: user.uid, isNewUser: isNewUser)
				
				Analytics.logEvent("auth_sign_in_success", parameters: [
					"screen": "auth" as NSString,
					"is_new_user": NSNumber(value: isNewUser)
				])
				
				self.servicesLocator.loginUser()
				
				// Create or merge user doc by email (dedupe guard)
				self.createOrMergeUserDocument(user: user, isNewUser: isNewUser) {
					// Continue app boot regardless of merge outcome
					PonderApp.sharedHomeViewModel?.fetchAllDomains()
					
					// Only new Firebase users trigger onboarding
					if isNewUser {
						NotificationCenter.default.post(name: .triggerOnboarding, object: nil, userInfo: [
							"is_new_user": NSNumber(value: true),
							"uid": user.uid as NSString
						])
						Analytics.logEvent("onboarding_trigger_new_user", parameters: [
							"screen": "auth" as NSString
						])
					}
					
					NotificationCenter.default.post(name: .userDidAuthenticate, object: nil)
				}
			}
			
		case .failure(let error):
			finishWithError(error.localizedDescription)
		}
	}
	
	// ─────────── Section Header ───────────
	private func ensureLaunchDestinationPreferenceForSignedInUser(uid: String, isNewUser: Bool) {
		let legacyKey = "launch_destination"
		let perUserKey = "launch_destination_\(uid)"
		
		let resolved: String = {
			if isNewUser {
				return LaunchDestination.categories.rawValue
			}
			if let perUser = UserDefaults.standard.string(forKey: perUserKey), !perUser.isEmpty {
				return perUser
			}
			if let legacy = UserDefaults.standard.string(forKey: legacyKey), !legacy.isEmpty {
				return legacy
			}
			return LaunchDestination.cards.rawValue
		}()
		
		UserDefaults.standard.set(resolved, forKey: perUserKey)
		UserDefaults.standard.set(resolved, forKey: legacyKey)
		
		NotificationCenter.default.post(
			name: .launchDestinationPreferenceDidChange,
			object: nil,
			userInfo: [
				"value": resolved as NSString,
				"trigger": (isNewUser ? "new_user_default" : "auth_sign_in") as NSString
			]
		)
		
		if isNewUser {
			Analytics.logEvent("auth_default_launch_destination_categories", parameters: [
				"screen": "auth" as NSString,
				"trigger": "new_user_default" as NSString
			])
		}
	}
	
	// ─────────── Section Header ───────────
	/// Creates the current user's Firestore doc if missing, but first merges any
	/// existing docs that share the same email (prevents duplicate user docs).
	private func createOrMergeUserDocument(user: FirebaseAuth.User,
										   isNewUser: Bool,
										   completion: @escaping () -> Void) {
		let db = Firestore.firestore()
		let users = db.collection("users")
		let uid = user.uid
		let email = (user.email ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		
		let defaults: [String: Any] = [
			"email"               : email,
			"favoriteTopicIds"    : [],
			"onboarded"           : isNewUser ? false : true,
			"reviewPromptShown"   : false,
			"surveyPromptShown"   : false,
			"entitlements"        : []
		]
		
		func writeMerged(_ data: [String: Any], done: @escaping () -> Void) {
			users.document(uid).setData(data, merge: true) { err in
				if let err {
					Analytics.logEvent("user_doc_write_error", parameters: [
						"screen": "auth" as NSString,
						"message": err.localizedDescription as NSString
					])
				} else {
					Analytics.logEvent("user_doc_upsert", parameters: [
						"screen": "auth" as NSString
					])
				}
				done()
			}
		}
		
		// 1) If our UID doc already exists, we’re done (no duplicates created now).
		users.document(uid).getDocument { snap, _ in
			if let snap, snap.exists {
				completion()
				return
			}
			
			// 2) Probe for any *other* docs that share this email.
			guard !email.isEmpty else {
				// No email to dedupe on; just create
				writeMerged(defaults) { completion() }
				return
			}
			
			users.whereField("email", isEqualTo: email).getDocuments { qs, _ in
				let others = (qs?.documents ?? []).filter { $0.documentID != uid }
				
				// If none, just create our doc with defaults
				guard let first = others.first else {
					writeMerged(defaults) { completion() }
					return
				}
				
				// 3) Merge fields from the first found duplicate into our current UID.
				var merged = defaults
				let old = first.data()
				
				func boolOr(_ key: String) {
					let a = (merged[key] as? Bool) ?? false
					let b = (old[key]    as? Bool) ?? false
					merged[key] = NSNumber(value: a || b)
				}
				boolOr("onboarded")
				boolOr("reviewPromptShown")
				boolOr("surveyPromptShown")
				
				if let role = old["role"] as? String, (merged["role"] as? String)?.isEmpty ?? true {
					merged["role"] = role
				}
				if let voice = old["voiceStyle"] as? String, (merged["voiceStyle"] as? String)?.isEmpty ?? true {
					merged["voiceStyle"] = voice
				}
				if let ents = old["entitlements"] as? [String] {
					let base = (merged["entitlements"] as? [String]) ?? []
					merged["entitlements"] = Array(Set(base).union(ents))
				}
				if let favsOld = old["favoriteTopicIds"] as? [String] {
					let favsNew = (merged["favoriteTopicIds"] as? [String]) ?? []
					merged["favoriteTopicIds"] = Array(Set(favsNew).union(favsOld))
				}
				if let loc = old["locale"] as? String, (merged["locale"] as? String)?.isEmpty ?? true {
					merged["locale"] = loc
				}
				if let tz = old["timezoneOffsetMinutes"] as? Int {
					merged["timezoneOffsetMinutes"] = tz
				}
				if let sub = old["subscription"] as? [String: Any] {
					merged["subscription"] = sub
				}
				
				// 4) Upsert merged data into the *current* UID doc.
				writeMerged(merged) {
					// 5) Mark or remove old duplicate docs (best-effort; ignore failures)
					let oldRef = users.document(first.documentID)
					oldRef.setData(["mergedInto": uid], merge: true) { _ in
						oldRef.delete { _ in
							Analytics.logEvent("user_doc_dedupe", parameters: [
								"screen": "auth" as NSString,
								"from_uid": first.documentID as NSString,
								"to_uid": uid as NSString
							])
							completion()
						}
					}
				}
			}
		}
	}
	
	// ─────────── Helpers ───────────
	private func finishWithError(_ message: String) {
		self.errorMessage = message
		self.isSigningIn = false
		self.currentNonce = nil
		Analytics.logEvent("auth_apple_error", parameters: [
			"screen": "auth" as NSString,
			"message": message as NSString
		])
	}
	
	func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
		guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
			  let window = windowScene.windows.first else {
			return UIWindow()
		}
		return window
	}
}

// ─────────── Nonce utils ───────────
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
