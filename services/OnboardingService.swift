import Foundation
import Combine
import FirebaseAuth
import FirebaseFirestore
import FirebaseAnalytics

@MainActor
final class OnboardingService: ObservableObject {
	static let shared = OnboardingService()
	
	@Published var isReady: Bool = false
	@Published var onboarded: Bool = true
	@Published var shouldPresentOnboarding: Bool = false
	
	private let db = Firestore.firestore()
	private var authHandle: AuthStateDidChangeListenerHandle?
	private var presentedForUserId: String?
	
	private init() {
		authHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
			Task { @MainActor in
				guard let self else { return }
				self.isReady = false
				self.onboarded = true
				self.shouldPresentOnboarding = false
				if let user {
					self.loadOnboarded(for: user.uid)
				} else {
					self.presentedForUserId = nil
					self.isReady = true
				}
			}
		}
	}
	
	deinit {
		if let h = authHandle { Auth.auth().removeStateDidChangeListener(h) }
	}
	
	// ─────────── Section Header ───────────
	private func loadOnboarded(for uid: String) {
		db.collection("users").document(uid).getDocument { [weak self] snap, _ in
			Task { @MainActor in
				guard let self else { return }
				let data = snap?.data()
				let flag = (data?["onboarded"] as? Bool) ?? false
				self.onboarded = flag
				if !flag && self.presentedForUserId != uid {
					self.shouldPresentOnboarding = true
					self.presentedForUserId = uid
				} else {
					self.shouldPresentOnboarding = false
				}
				self.isReady = true
			}
		}
	}
	
	// ─────────── Section Header ───────────
	func markCompleted() {
		guard let uid = Auth.auth().currentUser?.uid else { return }
		db.collection("users").document(uid).setData(["onboarded": true], merge: true)
		onboarded = true
		shouldPresentOnboarding = false
		Analytics.logEvent("onboarding_mark_completed", parameters: [
			"screen": "onboarding" as NSString
		])
		NotificationCenter.default.post(name: .didCompleteOnboarding, object: nil)
	}
}
