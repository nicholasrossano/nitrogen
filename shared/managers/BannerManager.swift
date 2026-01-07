import Foundation
import FirebaseRemoteConfig
import FirebaseAnalytics

class BannerManager: ObservableObject {
	static let shared = BannerManager()
	
	@Published var currentBanner: Banner? = nil
	
	private let remoteConfig = RemoteConfig.remoteConfig()
	private let seenBannersKey = "seen_banner_ids"
	private let firstSessionCompleteKey = "has_completed_first_session"
	
	private var hasCompletedFirstSession: Bool {
		UserDefaults.standard.bool(forKey: firstSessionCompleteKey)
	}
	
	init() {
		let settings = RemoteConfigSettings()
		settings.minimumFetchInterval = 0 // during development
		remoteConfig.configSettings = settings
		
		if hasCompletedFirstSession {
			fetchBanner()
		} else {
			Analytics.logEvent("banner_fetch_suppressed_first_session", parameters: [
				"screen": "app" as NSString
			])
		}
	}
	
	func fetchBanner() {
		guard hasCompletedFirstSession else {
			Analytics.logEvent("banner_fetch_blocked_first_session", parameters: [
				"screen": "app" as NSString
			])
			return
		}
		
		remoteConfig.fetchAndActivate { [weak self] status, error in
			guard let self = self else { return }
			DispatchQueue.main.async {
				if let error = error {
					print("BannerManager: RemoteConfig fetch failed: \(error.localizedDescription)")
					return
				}
				
				let jsonString = self.remoteConfig["banner_announcements"].stringValue ?? ""
				guard let data = jsonString.data(using: .utf8) else {
					print("BannerManager: Invalid JSON string")
					return
				}
				
				let seen = UserDefaults.standard.stringArray(forKey: self.seenBannersKey) ?? []
				
				guard let allBanners = try? JSONDecoder().decode([Banner].self, from: data) else {
					print("BannerManager: Failed to decode banner JSON")
					return
				}
				
				guard let banner = allBanners.first(where: { !seen.contains($0.id) }) else {
					print("BannerManager: No unseen banners")
					return
				}
				
				self.currentBanner = banner
				
				DispatchQueue.main.asyncAfter(deadline: .now() + 22) {
					if self.currentBanner?.id == banner.id {
						self.dismissBanner()
					}
				}
			}
		}
	}
	
	func dismissBanner() {
		guard let banner = currentBanner else { return }
		
		var seen = UserDefaults.standard.stringArray(forKey: seenBannersKey) ?? []
		seen.append(banner.id)
		UserDefaults.standard.setValue(seen, forKey: seenBannersKey)
		
		currentBanner = nil
	}
}
