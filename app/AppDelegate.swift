import UIKit
import FirebaseCore
import FirebaseCrashlytics
import FirebasePerformance
import FirebaseMessaging
import UserNotifications
import FirebaseAnalytics
import FBSDKCoreKit

class AppDelegate: NSObject, UIApplicationDelegate {
	
	func application(
		_ application: UIApplication,
		didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
	) -> Bool {
		
		if FirebaseApp.app() == nil {
			FirebaseApp.configure()
		}
		
#if DEBUG
		Analytics.setAnalyticsCollectionEnabled(false)
#endif
		
		Performance.sharedInstance().isDataCollectionEnabled = true
		Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(true)
		
		ApplicationDelegate.shared.application(
			application,
			didFinishLaunchingWithOptions: launchOptions
		)
		
#if DEBUG
		FBSDKCoreKit.Settings.shared.enableLoggingBehavior(.appEvents)
		FBSDKCoreKit.Settings.shared.enableLoggingBehavior(.informational)
		FBSDKCoreKit.Settings.shared.isAutoLogAppEventsEnabled = true
		FBSDKCoreKit.Settings.shared.isAdvertiserIDCollectionEnabled = true
#endif
		
		debugPrintMetaConfiguration()
		
		application.beginReceivingRemoteControlEvents()
		
		UNUserNotificationCenter.current().delegate = NotificationManager.shared
		Messaging.messaging().delegate = NotificationManager.shared
		
		if let remote = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
			print("🔔 LaunchOptions remoteNotification: \(remote)")
			NotificationManager.shared.handleLaunchRemoteNotification(userInfo: remote)
		}
		
		return true
	}
	
	func applicationDidBecomeActive(_ application: UIApplication) {
		AppEvents.shared.activateApp()
		
#if DEBUG
		let params: [AppEvents.ParameterName: Any] = [
			AppEvents.ParameterName("screen"): "app",
			AppEvents.ParameterName("build"): (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "",
			AppEvents.ParameterName("build_number"): (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String) ?? ""
		]
		
		AppEvents.shared.logEvent(AppEvents.Name("foreword_meta_smoke_test"), parameters: params)
		AppEvents.shared.flush()
#endif
	}
	
	func application(
		_ application: UIApplication,
		open url: URL,
		options: [UIApplication.OpenURLOptionsKey : Any] = [:]
	) -> Bool {
		return ApplicationDelegate.shared.application(application, open: url, options: options)
	}
	
	// ─────────── APNs Token → FCM Mapping ───────────
	func application(
		_ application: UIApplication,
		didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
	) {
		Messaging.messaging().apnsToken = deviceToken
		let tokenHex = deviceToken.map { String(format: "%02x", $0) }.joined()
		print("📨 APNs deviceToken (hex) =", tokenHex)
		Analytics.logEvent("apns_device_token_registered", parameters: [
			"screen": "system_notification" as NSString
		])
	}
	
	func application(
		_ application: UIApplication,
		didFailToRegisterForRemoteNotificationsWithError error: Error
	) {
		print("❌ APNs registration failed:", error.localizedDescription)
		Analytics.logEvent("apns_device_token_failed", parameters: [
			"screen": "system_notification" as NSString,
			"error": error.localizedDescription as NSString
		])
	}
	
	// ─────────── Section Header ───────────
	func application(
		_ application: UIApplication,
		didReceiveRemoteNotification userInfo: [AnyHashable : Any],
		fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
	) {
		print("🔔 didReceiveRemoteNotification(userInfo): \(userInfo)")
		NotificationManager.shared.handleLaunchRemoteNotification(userInfo: userInfo)
		completionHandler(.noData)
	}
	
	// ─────────── Section Header ───────────
	private func debugPrintMetaConfiguration() {
		let plistAppID = (Bundle.main.object(forInfoDictionaryKey: "FacebookAppID") as? String) ?? ""
		let plistClientToken = (Bundle.main.object(forInfoDictionaryKey: "FacebookClientToken") as? String) ?? ""
		let plistDisplayName = (Bundle.main.object(forInfoDictionaryKey: "FacebookDisplayName") as? String) ?? ""
		let plistAutoLog = Bundle.main.object(forInfoDictionaryKey: "FacebookAutoLogAppEventsEnabled")
		
		print("📘 Meta SDK config:")
		print("   - FacebookAppID (plist): \(plistAppID.isEmpty ? "MISSING" : plistAppID)")
		print("   - FacebookClientToken (plist): \(plistClientToken.isEmpty ? "MISSING" : "present")")
		print("   - FacebookDisplayName (plist): \(plistDisplayName.isEmpty ? "MISSING" : plistDisplayName)")
		print("   - FacebookAutoLogAppEventsEnabled (plist): \(plistAutoLog.map { "\($0)" } ?? "MISSING")")
		print("   - Settings.shared.appID: \(FBSDKCoreKit.Settings.shared.appID ?? "nil")")
	}
}
