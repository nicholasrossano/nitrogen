import Foundation
import UserNotifications
import FirebaseFirestore
import FirebaseAnalytics
import FirebaseAuth
import FirebaseMessaging
import UIKit
import Combine

final class NotificationManager: NSObject, UNUserNotificationCenterDelegate, MessagingDelegate {
	private enum NotificationDelivery: String {
		case remote
		case local
	}
	
	private static let voiceDigestNotificationIdentifier = "voiceDailyDigestNotification"
	private static let voiceDigestNotificationType = "voice_daily_digest"
	
	static let shared = NotificationManager()
	private override init() {}
	
	private var servicesLocator: AppServicesLocator?
	private var cancellables = Set<AnyCancellable>()
	
	private var pendingCardIdFromNotification: String?
	
	// ─────────── Badge Syncing ───────────
	private enum BadgeMode { case none, deliveredCount }
	private let badgeMode: BadgeMode = .none
	
	func syncBadgeNow() {
		switch badgeMode {
		case .none:
			DispatchQueue.main.async {
				UIApplication.shared.applicationIconBadgeNumber = 0
				Analytics.logEvent("push_badge_sync", parameters: [
					"screen": "app" as NSString,
					"mode": "none" as NSString,
					"count": NSNumber(value: 0)
				])
			}
		case .deliveredCount:
			UNUserNotificationCenter.current().getDeliveredNotifications { notifications in
				let count = notifications.filter {
					let t = $0.request.content.userInfo["notification_type"] as? String ?? ""
					return t != Self.voiceDigestNotificationType
				}.count
				DispatchQueue.main.async {
					UIApplication.shared.applicationIconBadgeNumber = count
					Analytics.logEvent("push_badge_sync", parameters: [
						"screen": "app" as NSString,
						"mode": "delivered_count" as NSString,
						"count": NSNumber(value: count)
					])
				}
			}
		}
	}
	
	// ─────────── Section Header ───────────
	func configure(servicesLocator: AppServicesLocator) {
		self.servicesLocator = servicesLocator
		
		UNUserNotificationCenter.current().delegate = self
		Messaging.messaging().delegate = self
		
		UNUserNotificationCenter.current().getNotificationSettings { settings in
			DispatchQueue.main.async {
				switch settings.authorizationStatus {
				case .authorized, .provisional, .ephemeral:
					UIApplication.shared.registerForRemoteNotifications()
					self.syncTimePreferencesForPush()
					self.captureInitialFcmToken()
				case .denied, .notDetermined:
					break
				@unknown default:
					break
				}
			}
		}
		
		purgeLegacyLocalNotifications()
		
		if let cardId = pendingCardIdFromNotification {
			pendingCardIdFromNotification = nil
			routeToCard(cardId: cardId)
		}
		
		NotificationCenter.default.addObserver(
			forName: .forewordAppReady,
			object: nil,
			queue: .main
		) { [weak self] _ in
			guard let self else { return }
			if let cardId = self.pendingCardIdFromNotification {
				self.pendingCardIdFromNotification = nil
				self.routeToCard(cardId: cardId)
			}
		}
		
		syncBadgeNow()
	}
	
	func handleLaunchRemoteNotification(userInfo: [AnyHashable: Any]) {
		print("🔔 handleLaunchRemoteNotification userInfo=\(userInfo)")
		let notificationType = (userInfo["notification_type"] as? String) ?? ""
		
		if notificationType == Self.voiceDigestNotificationType { return }
		
		let cardId = (userInfo["card_id"] as? String) ?? ""
		if !cardId.isEmpty {
			if ForewordApp.sharedHomeViewModel == nil || servicesLocator == nil {
				pendingCardIdFromNotification = cardId
			} else {
				routeToCard(cardId: cardId)
			}
		}
		
		syncBadgeNow()
	}
	
	func requestAuthorization(completion: @escaping (Bool) -> Void) {
		Analytics.logEvent("push_permission_prompt_shown", parameters: [
			"screen": "app" as NSString
		])
		UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
			if let error = error {
				print("Error requesting permission: \(error)")
			}
			DispatchQueue.main.async {
				if granted {
					Analytics.logEvent("push_permission_granted", parameters: [
						"screen": "app" as NSString
					])
					UIApplication.shared.registerForRemoteNotifications()
					self.syncTimePreferencesForPush()
					self.captureInitialFcmToken()
					self.purgeLegacyLocalNotifications()
					self.syncBadgeNow()
				} else {
					Analytics.logEvent("push_permission_denied", parameters: [
						"screen": "app" as NSString
					])
				}
				completion(granted)
			}
		}
	}
	
	private func captureInitialFcmToken() {
		Messaging.messaging().token { token, error in
			if let error = error {
				print("FCM token fetch error: \(error)")
				return
			}
			guard let token = token else { return }
			self.saveFcmToken(token: token)
		}
	}
	
	func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
		guard let token = fcmToken else { return }
		Analytics.logEvent("push_token_received", parameters: [
			"screen": "app" as NSString
		])
		saveFcmToken(token: token)
	}
	
	private func saveFcmToken(token: String) {
		let env: String = {
#if DEBUG
			return "sandbox"
#else
			return "production"
#endif
		}()
		let appVersion = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"
		let deviceId = UIDevice.current.identifierForVendor?.uuidString
		
		servicesLocator?.notificationsService
			.upsertFcmToken(
				token: token,
				apnsEnvironment: env,
				appVersion: appVersion,
				deviceId: deviceId
			)
			.sink(receiveCompletion: { completion in
				if case .failure(let error) = completion {
					print("Failed to save FCM token: \(error)")
				}
			}, receiveValue: {
				Analytics.logEvent("push_token_saved", parameters: [
					"screen": "app" as NSString
				])
			})
			.store(in: &cancellables)
	}
	
	func syncTimePreferencesForPush() {
		let timezone = TimeZone.current
		let tzId = timezone.identifier
		let offsetMinutes = timezone.secondsFromGMT() / 60
		let preferred: [Int] = [7 * 60 + 30, 17 * 60 + 30]
		servicesLocator?.notificationsService
			.updateNotificationTimePreferences(timezoneIdentifier: tzId,
											   tzOffsetMinutes: offsetMinutes,
											   preferredPushMinutes: preferred)
			.sink(receiveCompletion: { completion in
				if case .failure(let error) = completion {
					print("Failed to update time prefs: \(error)")
				}
			}, receiveValue: { })
			.store(in: &cancellables)
	}
	
	// ─────────── Section Header ───────────
	func scheduleAllNotifications() {
		purgeLegacyLocalNotifications()
		if useRemotePush {
			Analytics.logEvent("push_local_schedule_skipped", parameters: [
				"screen": "app" as NSString
			])
			return
		}
		scheduleMorningNotification()
		scheduleEveningNotification()
	}
	
	func scheduleMorningNotification() {
		guard !useRemotePush else { return }
		let content = UNMutableNotificationContent()
		content.title = "New Cards Available"
		content.body = "Take a moment to browse this morning."
		content.sound = .default
		content.userInfo = ["notification_type": "morning_push_notification"]
		content.badge = nil
		
		var dateComponents = DateComponents()
		dateComponents.hour = 7
		dateComponents.minute = 30
		
		let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
		let request = UNNotificationRequest(
			identifier: "morningPonderNotification",
			content: content,
			trigger: trigger
		)
		
		UNUserNotificationCenter.current().add(request) { error in
			if let error = error {
				print("Error scheduling morning notification: \(error)")
			} else {
				print("Morning notification scheduled.")
			}
		}
	}
	
	func scheduleEveningNotification() {
		guard !useRemotePush else { return }
		let content = UNMutableNotificationContent()
		content.title = "New Cards Available"
		content.body = "Take a moment to browse this evening."
		content.sound = .default
		content.userInfo = ["notification_type": "evening_push_notification"]
		content.badge = nil
		
		var dateComponents = DateComponents()
		dateComponents.hour = 17
		dateComponents.minute = 30
		
		let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
		let request = UNNotificationRequest(
			identifier: "eveningPonderNotification",
			content: content,
			trigger: trigger
		)
		
		UNUserNotificationCenter.current().add(request) { error in
			if let error = error {
				print("Error scheduling evening notification: \(error)")
			} else {
				print("Evening notification scheduled.")
			}
		}
	}
	
	func cancelAllNotifications() {
		UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
		UNUserNotificationCenter.current().removeAllDeliveredNotifications()
		UIApplication.shared.applicationIconBadgeNumber = 0
		print("All notifications canceled.")
	}
	
	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		didReceive response: UNNotificationResponse,
		withCompletionHandler completionHandler: @escaping () -> Void
	) {
		let userInfo = response.notification.request.content.userInfo
		print("🔔 didReceive tap userInfo=\(userInfo)")
		
		let notificationType = userInfo["notification_type"] as? String ?? "unknown"
		let cardId = userInfo["card_id"] as? String ?? ""
		let delivery: NotificationDelivery = (response.notification.request.trigger is UNPushNotificationTrigger)
		? .remote
		: .local
		
		Analytics.logEvent("notification_clicked", parameters: [
			"screen": "app" as NSString,
			"type": notificationType as NSString,
			"card_id": cardId as NSString
		])
		
		Analytics.logEvent("notification_tap", parameters: [
			"screen": "system_notification" as NSString,
			"notification_type": notificationType as NSString,
			"trigger": delivery.rawValue as NSString
		])
		
		if notificationType == Self.voiceDigestNotificationType {
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.syncBadgeNow() }
			completionHandler()
			return
		}
		
		if !cardId.isEmpty {
			DispatchQueue.main.async {
				if ForewordApp.sharedHomeViewModel == nil || self.servicesLocator == nil {
					self.pendingCardIdFromNotification = cardId
				} else {
					self.routeToCard(cardId: cardId)
				}
			}
		}
		
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.syncBadgeNow() }
		completionHandler()
	}
	
	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		willPresent notification: UNNotification,
		withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
	) {
		let userInfo = notification.request.content.userInfo
		print("🔔 willPresent userInfo=\(userInfo)")
		
		let notificationType = userInfo["notification_type"] as? String ?? "unknown"
		Analytics.logEvent("notification_delivered", parameters: [
			"screen": "system_notification" as NSString,
			"notification_type": notificationType as NSString
		])
		
		if notificationType == Self.voiceDigestNotificationType {
			self.syncBadgeNow()
			completionHandler([])
			return
		}
		
		self.syncBadgeNow()
		completionHandler([.banner, .sound])
	}
	
	private func routeToCard(cardId: String) {
		guard let vm = ForewordApp.sharedHomeViewModel else {
			print("⚠️ routeToCard: VM not ready; deferring")
			pendingCardIdFromNotification = cardId
			return
		}
		
		let domainID = "home"
		
		print("routeToCard cardId=\(cardId) domainID=\(domainID)")
		vm.handleDeepLink(domainID: domainID, cardID: cardId)
		servicesLocator?.visibilityNotifier.mode = .expandedCard
		vm.isCardExpanded = true
	}
	
	// ─────────── Section Header ───────────
	private func purgeLegacyLocalNotifications() {
		let ids = ["morninNotification", "eveningNotification", Self.voiceDigestNotificationIdentifier]
		let center = UNUserNotificationCenter.current()
		center.removePendingNotificationRequests(withIdentifiers: ids)
		center.removeDeliveredNotifications(withIdentifiers: ids)
		Analytics.logEvent("push_legacy_local_purge", parameters: [
			"screen": "app" as NSString
		])
	}
	
	private var useRemotePush: Bool {
		guard let override = UserDefaults.standard.object(forKey: "force_local_voice_digest_fallback") as? Bool else {
			return true
		}
		return !override
	}
}
