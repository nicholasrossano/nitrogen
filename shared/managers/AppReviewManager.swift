import StoreKit
import UIKit
import Combine
import FirebaseAnalytics
import FirebaseFirestore

class AppReviewManager {
	static let shared = AppReviewManager()
	
	// ─────────── Keys ───────────
	private let reviewPromptCountKey  = "reviewPromptCountKey"
	private let reviewSessionKey      = "reviewSessionKey"
	private let expandedCardsCountKey = "expandedCardsCountKey"
	private let appSessionCountKey    = "reviewAppSessionCountKey"
	
	// ─────────── Session State ───────────
	private var sessionSwipeCount: Int = 0
	private var sessionDeepEvents = Set<ReviewEngagementEvent>()
	private var hasPromptedThisSession = false
	
	private var isArmedForPrompt = false
	private var armReason: String = ""
	
	// ─────────── Combine ───────────
	private var cancellables = Set<AnyCancellable>()
	
	// ─────────── Tunables ───────────
	private let minSwipesSession: Int = 15
	
	// ─────────── Week Bucket ───────────
	private var currentWeekIdentifier: String {
		let now = Date()
		let cal = Calendar.current
		let year = cal.component(.year, from: now)
		let week = cal.component(.weekOfYear, from: now)
		return "\(year)-\(week)"
	}
	
	// ─────────── Init ───────────
	private init() {
		NotificationCenter.default.addObserver(self,
											   selector: #selector(handleDidEnterBackground),
											   name: UIApplication.didEnterBackgroundNotification,
											   object: nil)
		
		let current = UserDefaults.standard.integer(forKey: appSessionCountKey)
		let next = current + 1
		UserDefaults.standard.set(next, forKey: appSessionCountKey)
		
		Analytics.logEvent("review_session_increment", parameters: [
			"screen": "home" as NSString,
			"session_count": NSNumber(value: next)
		])
	}
	
	@objc private func handleDidEnterBackground() {
		resetSessionCounters()
	}
	
	private func resetSessionCounters() {
		sessionSwipeCount = 0
		sessionDeepEvents.removeAll()
		hasPromptedThisSession = false
		isArmedForPrompt = false
		armReason = ""
		UserDefaults.standard.set(0, forKey: expandedCardsCountKey)
	}
	
	// ─────────── Hard Block Helper ───────────
	private func hardBlockIsActive() -> Bool {
		if let u = AppServicesLocator.shared.userService.user, u.reviewPromptShown == true { return true }
		return false
	}
	
	// ─────────── Public (legacy names kept) ───────────
	func incrementExpandedCardsCount() {
		sessionSwipeCount += 1
		UserDefaults.standard.set(sessionSwipeCount, forKey: expandedCardsCountKey)
		evaluateEligibility(trigger: "swipe")
	}
	
	func resetExpandedCardsCount() { UserDefaults.standard.set(0, forKey: expandedCardsCountKey) }
	func getExpandedCardsCount() -> Int { sessionSwipeCount }
	
	// ─────────── Deep Engagement API ───────────
	enum ReviewEngagementEvent: String, Hashable, CaseIterable {
		case exitCurator
		case openSource
		case share
		case bookmark
		case longRead
	}
	
	func recordDeepEngagement(_ event: ReviewEngagementEvent) {
		guard !hardBlockIsActive() else { return }
		sessionDeepEvents.insert(event)
		evaluateEligibility(trigger: "deep_engagement_\(event.rawValue)")
	}
	
	// ─────────── Safe Actions (consume arm) ───────────
	enum ReviewSafeAction: String {
		case swipeNext
		case swipePrev
		case exitCurator
		case openSource
		case share
		case bookmark
	}
	
	func notifyUserAction(_ action: ReviewSafeAction) {
		guard AppServicesLocator.shared.userService.getUserId() != nil else { return }
		guard !hardBlockIsActive() else { return }
		if hasPromptedThisSession { return }
		
		if isArmedForPrompt {
			presentReview(trigger: "armed_\(action.rawValue)")
			isArmedForPrompt = false
			armReason = ""
		}
	}
	
	// ─────────── Weekly Prompt Count ───────────
	private func getReviewPromptCount() -> Int {
		let storedWeek = UserDefaults.standard.string(forKey: reviewSessionKey)
		if storedWeek != currentWeekIdentifier {
			UserDefaults.standard.set(currentWeekIdentifier, forKey: reviewSessionKey)
			UserDefaults.standard.set(0, forKey: reviewPromptCountKey)
			return 0
		}
		return UserDefaults.standard.integer(forKey: reviewPromptCountKey)
	}
	
	private func incrementReviewPromptCount() {
		let newCount = getReviewPromptCount() + 1
		UserDefaults.standard.set(newCount, forKey: reviewPromptCountKey)
	}
	
	// ─────────── Manual ───────────
	func requestReviewIfEligible() {
		guard !hardBlockIsActive() else { return }
		evaluateEligibility(trigger: "manual")
		notifyUserAction(.swipeNext)
	}
	
	// ─────────── Gate: arm only ───────────
	private func evaluateEligibility(trigger: String) {
		guard AppServicesLocator.shared.userService.getUserId() != nil else { return }
		if hasPromptedThisSession { return }
		
		let sessionCount = UserDefaults.standard.integer(forKey: appSessionCountKey)
		if sessionCount < 3 {
			Analytics.logEvent("review_eligibility_check", parameters: [
				"screen": "home" as NSString,
				"trigger": trigger as NSString,
				"swipes_in_session": NSNumber(value: sessionSwipeCount),
				"deep_events_count": NSNumber(value: sessionDeepEvents.count),
				"eligible": NSNumber(value: 0),
				"session_count": NSNumber(value: sessionCount),
				"reason": "insufficient_sessions" as NSString
			])
			return
		}
		
		guard !hardBlockIsActive() else {
			Analytics.logEvent("review_prompt_suppressed", parameters: [
				"screen": "home" as NSString,
				"trigger": trigger as NSString,
				"reason": "hard_block" as NSString
			])
			return
		}
		
		let reviewCount = getReviewPromptCount()
		let eligible = (sessionSwipeCount >= minSwipesSession) && (reviewCount < 2)
		
		Analytics.logEvent("review_eligibility_check", parameters: [
			"screen": "home" as NSString,
			"trigger": trigger as NSString,
			"swipes_in_session": NSNumber(value: sessionSwipeCount),
			"deep_events_count": NSNumber(value: sessionDeepEvents.count),
			"eligible": NSNumber(value: eligible ? 1 : 0),
			"session_count": NSNumber(value: sessionCount),
			"review_count": NSNumber(value: reviewCount)
		])
		
		guard eligible else { return }
		
		isArmedForPrompt = true
		armReason = "swipes_only"
		Analytics.logEvent("review_arm_set", parameters: [
			"screen": "home" as NSString,
			"arm_reason": armReason as NSString,
			"swipes_in_session": NSNumber(value: sessionSwipeCount),
			"deep_events_count": NSNumber(value: sessionDeepEvents.count)
		])
	}
	
	// ─────────── Present & Persist ───────────
	private func presentReview(trigger: String) {
		if hasPromptedThisSession { return }
		hasPromptedThisSession = true
		
		let foregroundScene = UIApplication.shared.connectedScenes
			.compactMap { $0 as? UIWindowScene }
			.first { $0.activationState == .foregroundActive }
		
		Analytics.logEvent("review_prompt_request", parameters: [
			"screen": "home" as NSString,
			"trigger": trigger as NSString,
			"arm_reason": armReason as NSString,
			"swipes_in_session": NSNumber(value: sessionSwipeCount),
			"deep_events_count": NSNumber(value: sessionDeepEvents.count)
		])
		
		presentEnjoymentGate(using: foregroundScene, trigger: trigger)
		
		incrementReviewPromptCount()
		
		if var updated = AppServicesLocator.shared.userService.user {
			if updated.reviewPromptShown == false {
				updated.reviewPromptShown = true
				AppServicesLocator.shared.userService.updateUserDetails(user: updated)
					.sink(receiveCompletion: { completion in
						if case .failure(let error) = completion {
							print("Error updating reviewPromptShown flag: \(error)")
						}
					}, receiveValue: { _ in
						Analytics.logEvent("review_prompt_mark_shown", parameters: [
							"screen": "home" as NSString,
							"trigger": trigger as NSString
						])
					})
					.store(in: &cancellables)
			}
		}
	}
	
	// ─────────── Enjoyment Gate & Feedback ───────────
	private func presentEnjoymentGate(using scene: UIWindowScene?, trigger: String) {
		guard let presenter = topViewController(from: scene) else {
			showStoreReview(using: scene, trigger: trigger)
			return
		}
		
		let alert = UIAlertController(
			title: "Enjoying Foreword AI?",
			message: "Tell us how your experience has been. We're a small team always working to improve.",
			preferredStyle: .alert
		)
		
		let noAction = UIAlertAction(title: "Not really", style: .default) { [weak self] _ in
			guard let self = self else { return }
			Analytics.logEvent("review_enjoyment_response", parameters: [
				"screen": "home" as NSString,
				"response": "no" as NSString,
				"trigger": trigger as NSString
			])
			self.presentFeedbackPrompt(using: scene, trigger: trigger)
		}
		
		let yesAction = UIAlertAction(title: "Yes!", style: .default) { [weak self] _ in
			guard let self = self else { return }
			Analytics.logEvent("review_enjoyment_response", parameters: [
				"screen": "home" as NSString,
				"response": "yes" as NSString,
				"trigger": trigger as NSString
			])
			self.showStoreReview(using: scene, trigger: trigger)
		}
		
		alert.addAction(noAction)
		alert.addAction(yesAction)
		
		Analytics.logEvent("review_enjoyment_gate_shown", parameters: [
			"screen": "home" as NSString,
			"trigger": trigger as NSString
		])
		
		DispatchQueue.main.async {
			presenter.present(alert, animated: true, completion: nil)
		}
	}
	
	private func presentFeedbackPrompt(using scene: UIWindowScene?, trigger: String) {
		guard let presenter = topViewController(from: scene) else { return }
		
		let alert = UIAlertController(
			title: "Help us improve",
			message: "How can we do better? Your feedback goes straight to the team.",
			preferredStyle: .alert
		)
		
		alert.addTextField { textField in
			textField.placeholder = "Your feedback"
		}
		
		let sendAction = UIAlertAction(title: "Send", style: .default) { [weak self, weak alert] _ in
			guard let self = self else { return }
			let text = alert?.textFields?.first?.text ?? ""
			
			let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
			Analytics.logEvent("review_feedback_send_tap", parameters: [
				"screen": "home" as NSString,
				"has_text": NSNumber(value: hasText),
				"trigger": trigger as NSString
			])
			
			self.submitFeedback(text, trigger: trigger)
		}
		
		let skipAction = UIAlertAction(title: "Skip", style: .cancel) { _ in
			Analytics.logEvent("review_feedback_skip", parameters: [
				"screen": "home" as NSString,
				"trigger": trigger as NSString
			])
		}
		
		alert.addAction(skipAction)
		alert.addAction(sendAction)
		
		Analytics.logEvent("review_feedback_prompt_shown", parameters: [
			"screen": "home" as NSString,
			"trigger": trigger as NSString
		])
		
		DispatchQueue.main.async {
			presenter.present(alert, animated: true, completion: nil)
		}
	}
	
	private func submitFeedback(_ text: String, trigger: String) {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		
		let db = Firestore.firestore()
		var data: [String: Any] = [
			"message": trimmed,
			"createdAt": Timestamp(date: Date()),
			"source": "app_review_gate",
			"trigger": trigger
		]
		
		if let userId = AppServicesLocator.shared.userService.getUserId() {
			data["userId"] = userId
		}
		
		db.collection("appFeedback").addDocument(data: data) { error in
			if let error = error {
				print("Error saving feedback: \(error)")
				Analytics.logEvent("review_feedback_error", parameters: [
					"screen": "home" as NSString
				])
			} else {
				Analytics.logEvent("review_feedback_submitted", parameters: [
					"screen": "home" as NSString
				])
			}
		}
	}
	
	private func showStoreReview(using scene: UIWindowScene?, trigger: String) {
		DispatchQueue.main.async {
			if let scene = scene {
				SKStoreReviewController.requestReview(in: scene)
			} else {
				SKStoreReviewController.requestReview()
			}
		}
	}
	
	// ─────────── Top VC helper ───────────
	private func topViewController(from scene: UIWindowScene?) -> UIViewController? {
		if let scene = scene {
			if let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController {
				return topMostViewController(root)
			}
		} else {
			let windowScene = UIApplication.shared.connectedScenes
				.compactMap { $0 as? UIWindowScene }
				.first { $0.activationState == .foregroundActive }
			
			if let root = windowScene?.windows.first(where: { $0.isKeyWindow })?.rootViewController {
				return topMostViewController(root)
			}
		}
		return nil
	}
	
	private func topMostViewController(_ root: UIViewController) -> UIViewController {
		if let nav = root as? UINavigationController, let visible = nav.visibleViewController {
			return topMostViewController(visible)
		}
		if let tab = root as? UITabBarController, let selected = tab.selectedViewController {
			return topMostViewController(selected)
		}
		if let presented = root.presentedViewController {
			return topMostViewController(presented)
		}
		return root
	}
}
