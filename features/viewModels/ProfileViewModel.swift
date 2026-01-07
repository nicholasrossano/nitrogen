import Combine
import SwiftUI
import FirebaseAuth
import UIKit
import UserNotifications
import FirebaseAnalytics

extension Notification.Name {
	static let bookmarksUpdated = Notification.Name("bookmarksUpdated")
	static let userDidLogout    = Notification.Name("userDidLogout")
}

// ─────────── Launch destination ───────────
enum LaunchDestination: String, CaseIterable, Identifiable {
	case categories
	case cards
	
	var id: String { rawValue }
	
	var displayName: String {
		switch self {
		case .categories: return "Categories"
		case .cards: return "Cards"
		}
	}
}

class ProfileViewModel: ObservableObject {
	@Published var email: String = ""
	@Published var notificationsEnabled: Bool = false {
		didSet {
			guard notificationsEnabled != oldValue else { return }
			guard !isApplyingNotificationPreference else { return }
			toggleNotifications(on: notificationsEnabled)
		}
	}
	
	@Published var autoplayMediaEnabled: Bool = false {
		didSet {
			guard autoplayMediaEnabled != oldValue else { return }
			guard !isApplyingAutoplayPreference else { return }
			UserDefaults.standard.set(autoplayMediaEnabled, forKey: "autoplay_media_enabled")
		}
	}
	
	@Published var spoilerProtectionEnabled: Bool = false {
		didSet {
			guard spoilerProtectionEnabled != oldValue else { return }
			guard !isApplyingSpoilerPreference else { return }
			UserDefaults.standard.set(spoilerProtectionEnabled, forKey: "spoiler_protection_enabled")
		}
	}
	
	@Published var launchDestination: LaunchDestination = .cards {
		didSet {
			guard launchDestination != oldValue else { return }
			guard !isApplyingLaunchDestinationPreference else { return }
			persistLaunchDestinationPreference(launchDestination)
		}
	}
	
	@Published var errorMessage: String?
	@Published var showSystemNotificationAlert: Bool = false
	@Published var hasBookmarks: Bool = false
	
	private let servicesLocator: AppServicesLocator
	private var cancellables = Set<AnyCancellable>()
	private var isApplyingNotificationPreference = false
	private var storedNotificationsPreference: Bool = false
	
	private var isApplyingAutoplayPreference = false
	private var isApplyingSpoilerPreference = false
	private var isApplyingLaunchDestinationPreference = false
	
	init(servicesLocator: AppServicesLocator = .shared) {
		self.servicesLocator = servicesLocator
		
		loadPreferences()
		
		NotificationCenter.default.publisher(for: .bookmarksUpdated)
			.sink { [weak self] _ in
				self?.loadPreferences()
			}
			.store(in: &cancellables)
	}
	
	func loadPreferences() {
		servicesLocator.userService.getUserEmail()
			.sink(receiveCompletion: { completion in
				if case .failure(let err) = completion {
					self.errorMessage = "Failed to load email: \(err.localizedDescription)"
				}
			}, receiveValue: { [weak self] email in
				self?.email = email
			})
			.store(in: &cancellables)
		
		servicesLocator.notificationsService.isNotificationsEnabled()
			.sink(receiveCompletion: { _ in }, receiveValue: { [weak self] stored in
				guard let self = self else { return }
				self.storedNotificationsPreference = stored
				self.checkSystemNotificationPermission(storedValue: stored)
			})
			.store(in: &cancellables)
		
		servicesLocator.bookmarksService.getBookmarkedCards()
			.sink(receiveCompletion: { _ in }, receiveValue: { [weak self] ids in
				DispatchQueue.main.async {
					self?.hasBookmarks = !ids.isEmpty
				}
			})
			.store(in: &cancellables)
		
		loadAutoplayPreference()
		loadSpoilerPreference()
		loadLaunchDestinationPreference()
	}
	
	private func loadAutoplayPreference() {
		let key = "autoplay_media_enabled"
		let value: Bool = {
			if let obj = UserDefaults.standard.object(forKey: key) as? Bool {
				return obj
			}
			return false
		}()
		setAutoplayToggleWithoutTrigger(value)
	}
	
	private func setAutoplayToggleWithoutTrigger(_ value: Bool) {
		guard autoplayMediaEnabled != value else { return }
		isApplyingAutoplayPreference = true
		autoplayMediaEnabled = value
		isApplyingAutoplayPreference = false
	}
	
	private func loadSpoilerPreference() {
		let key = "spoiler_protection_enabled"
		let value: Bool = {
			if let obj = UserDefaults.standard.object(forKey: key) as? Bool {
				return obj
			}
			return false
		}()
		setSpoilerToggleWithoutTrigger(value)
	}
	
	private func setSpoilerToggleWithoutTrigger(_ value: Bool) {
		guard spoilerProtectionEnabled != value else { return }
		isApplyingSpoilerPreference = true
		spoilerProtectionEnabled = value
		isApplyingSpoilerPreference = false
	}
	
	private func loadLaunchDestinationPreference() {
		let legacyKey = "launch_destination"
		let uid = Auth.auth().currentUser?.uid
		let perUserKey = uid.map { "launch_destination_\($0)" }
		
		let raw: String = {
			if let perUserKey, let v = UserDefaults.standard.string(forKey: perUserKey), !v.isEmpty {
				return v
			}
			if let v = UserDefaults.standard.string(forKey: legacyKey), !v.isEmpty {
				if let perUserKey {
					UserDefaults.standard.set(v, forKey: perUserKey)
				}
				return v
			}
			return LaunchDestination.cards.rawValue
		}()
		
		let value = LaunchDestination(rawValue: raw) ?? .cards
		setLaunchDestinationWithoutTrigger(value)
	}
	
	private func setLaunchDestinationWithoutTrigger(_ value: LaunchDestination) {
		guard launchDestination != value else { return }
		isApplyingLaunchDestinationPreference = true
		launchDestination = value
		isApplyingLaunchDestinationPreference = false
	}
	
	private func persistLaunchDestinationPreference(_ value: LaunchDestination) {
		let legacyKey = "launch_destination"
		UserDefaults.standard.set(value.rawValue, forKey: legacyKey)
		
		if let uid = Auth.auth().currentUser?.uid {
			let perUserKey = "launch_destination_\(uid)"
			UserDefaults.standard.set(value.rawValue, forKey: perUserKey)
		}
	}
	
	private func checkSystemNotificationPermission(storedValue: Bool) {
		UNUserNotificationCenter.current().getNotificationSettings { settings in
			DispatchQueue.main.async {
				self.setNotificationsToggleWithoutTrigger(storedValue)
				
				switch settings.authorizationStatus {
				case .authorized, .provisional, .ephemeral:
					if storedValue {
						self.ensureNotificationsScheduled()
					} else {
						NotificationManager.shared.cancelAllNotifications()
					}
				case .denied:
					NotificationManager.shared.cancelAllNotifications()
				case .notDetermined:
					break
				@unknown default:
					break
				}
			}
		}
	}
	
	private func toggleNotifications(on: Bool) {
		Analytics.logEvent("profile_notifications_toggle", parameters: [
			"enabled": NSNumber(value: on),
			"screen": "profile" as NSString
		])
		
		if on {
			UNUserNotificationCenter.current().getNotificationSettings { settings in
				DispatchQueue.main.async {
					switch settings.authorizationStatus {
					case .denied:
						self.showSystemNotificationAlert = true
						Analytics.logEvent("profile_notifications_denied_system", parameters: [
							"screen": "profile" as NSString
						])
						self.setNotificationsToggleWithoutTrigger(self.storedNotificationsPreference)
					case .authorized, .provisional, .ephemeral, .notDetermined:
						self.enableNotificationsAndPersistPreference()
					@unknown default:
						self.setNotificationsToggleWithoutTrigger(self.storedNotificationsPreference)
					}
				}
			}
		} else {
			storedNotificationsPreference = false
			NotificationManager.shared.cancelAllNotifications()
			updateNotificationsEnabledInFirestore(false)
		}
	}
	
	private func enableNotificationsAndPersistPreference() {
		storedNotificationsPreference = true
		ensureNotificationsScheduled()
		updateNotificationsEnabledInFirestore(true)
		Analytics.logEvent("profile_notifications_scheduled", parameters: [
			"screen": "profile" as NSString
		])
	}
	
	private func ensureNotificationsScheduled() {
		UIApplication.shared.registerForRemoteNotifications()
		NotificationManager.shared.syncTimePreferencesForPush()
		NotificationManager.shared.cancelAllNotifications()
		NotificationManager.shared.scheduleMorningNotification()
		NotificationManager.shared.scheduleEveningNotification()
	}
	
	private func setNotificationsToggleWithoutTrigger(_ value: Bool) {
		guard notificationsEnabled != value else { return }
		isApplyingNotificationPreference = true
		notificationsEnabled = value
		isApplyingNotificationPreference = false
	}
	
	private func updateNotificationsEnabledInFirestore(_ isEnabled: Bool) {
		servicesLocator.notificationsService
			.updateNotificationsEnabled(isEnabled: isEnabled)
			.sink(receiveCompletion: { _ in }, receiveValue: { })
			.store(in: &cancellables)
	}
	
	func logout() {
		do {
			try Auth.auth().signOut()
			Analytics.logEvent("profile_logout_success", parameters: [
				"screen": "profile" as NSString
			])
			NotificationCenter.default.post(name: .userDidLogout, object: nil)
		} catch {
			self.errorMessage = "Failed to log out: \(error.localizedDescription)"
			Analytics.logEvent("profile_logout_error", parameters: [
				"message": error.localizedDescription as NSString,
				"screen": "profile" as NSString
			])
		}
	}
	
	func openSystemSettings() {
		guard let url = URL(string: UIApplication.openSettingsURLString),
			  UIApplication.shared.canOpenURL(url)
		else { return }
		UIApplication.shared.open(url)
	}
	
	func deleteAccount() {
		servicesLocator.userActivityService.deleteAccount()
			.sink(receiveCompletion: { completion in
				if case .failure(let err) = completion {
					self.errorMessage = err.localizedDescription
					Analytics.logEvent("profile_delete_account_error", parameters: [
						"message": err.localizedDescription as NSString,
						"screen": "profile" as NSString
					])
				} else {
					Analytics.logEvent("profile_delete_account_success", parameters: [
						"screen": "profile" as NSString
					])
				}
			}, receiveValue: { })
			.store(in: &cancellables)
	}
}
