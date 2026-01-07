import UIKit
import FirebaseRemoteConfig
import FirebaseFirestore
import FirebaseAuth

final class FeatureFlagsManager: ObservableObject {
	static let shared = FeatureFlagsManager()
	
	// ─────────── Published flags ───────────
	@Published var isAudioButtonEnabled:         Bool = false
	@Published var isShareButtonEnabled:         Bool = false
	@Published var isCinemaWidgetEnabled:        Bool = false
	@Published var isMusicWidgetEnabled:         Bool = false
	@Published var isStockWidgetEnabled:         Bool = false
	@Published var isBookWidgetEnabled:          Bool = false
	@Published var isResearchWidgetEnabled:      Bool = false
	@Published var isRestaurantWidgetEnabled:    Bool = false
	@Published var isPoliticianWidgetEnabled:    Bool = false
	@Published var isCuratorButtonEnabled:       Bool = false
	@Published var isCuratorCardButtonEnabled:   Bool = false
	@Published var isVoiceModeEnabled:           Bool = false
	@Published var isVideoSearchEnabled:         Bool = false
	@Published var isSearchButtonEnabled:        Bool = false
	@Published var isPremiumSubscriptionEnabled: Bool = false
	@Published var isHomePageEnabled:            Bool = false
	@Published var isArtWidgetEnabled:           Bool = false
	@Published var isAutoplayEnabled:            Bool = false
	
	// NEW – role cached for limit bypass
	@Published var currentUserRole: String = "user"
	
	// ─────────── Load state ───────────
	@Published var hasLoadedRemoteFlags: Bool = false
	
	private let remoteConfig = RemoteConfig.remoteConfig()
	private let db = Firestore.firestore()
	private var authHandle: AuthStateDidChangeListenerHandle?
	
	private var timeoutTask: DispatchWorkItem?
	private let timeoutInterval: TimeInterval = 4
	
	// ─────────── Init ───────────
	private init() {
		let ud = UserDefaults.standard
		isAudioButtonEnabled           = ud.bool(forKey: "audio_button_enabled")
		isShareButtonEnabled           = ud.bool(forKey: "share_button_enabled")
		isCinemaWidgetEnabled          = ud.bool(forKey: "filmtv_widget_enabled")
		isMusicWidgetEnabled           = ud.bool(forKey: "music_widget_enabled")
		isStockWidgetEnabled           = ud.bool(forKey: "stock_widget_enabled")
		isBookWidgetEnabled            = ud.bool(forKey: "book_widget_enabled")
		isResearchWidgetEnabled        = ud.bool(forKey: "research_widget_enabled")
		isRestaurantWidgetEnabled      = ud.bool(forKey: "restaurant_widget_enabled")
		isPoliticianWidgetEnabled      = ud.bool(forKey: "politician_widget_enabled")
		isCuratorButtonEnabled         = ud.bool(forKey: "curator_button_enabled")
		isCuratorCardButtonEnabled     = ud.bool(forKey: "curator_card_button_enabled")
		isVoiceModeEnabled             = ud.bool(forKey: "voice_mode_enabled")
		isVideoSearchEnabled           = ud.bool(forKey: "video_search_enabled")
		isSearchButtonEnabled          = ud.bool(forKey: "search_button_enabled")
		isPremiumSubscriptionEnabled   = ud.bool(forKey: "premium_subscription_enabled")
		isHomePageEnabled              = ud.bool(forKey: "home_page_enabled")
		isArtWidgetEnabled             = ud.bool(forKey: "art_widget_enabled")
		isAutoplayEnabled              = ud.bool(forKey: "autoplay_enabled")
		
		authHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
			guard let self = self, user != nil else { return }
			self.fetchFeatureFlags()
		}
	}
	
	deinit {
		if let h = authHandle { Auth.auth().removeStateDidChangeListener(h) }
	}
	
	// ─────────── Remote fetch ───────────
	func fetchFeatureFlags() {
		hasLoadedRemoteFlags = false
		startTimeout()
		
		let settings = RemoteConfigSettings()
		settings.minimumFetchInterval = 3600
		remoteConfig.configSettings = settings
		
		remoteConfig.fetchAndActivate { [weak self] _, error in
			guard let self = self else { return }
			
			if let error = error {
				print("Remote Config fetch error: \(error.localizedDescription)")
				self.finishLoading()
				return
			}
			
			guard let uid = Auth.auth().currentUser?.uid else {
				self.finishLoading(); return
			}
			
			self.db.collection("users").document(uid).getDocument { doc, err in
				if let err = err {
					print("Firestore role fetch error: \(err.localizedDescription)")
					self.finishLoading(); return
				}
				
				let role = doc?.data()?["role"] as? String ?? "user"
				self.currentUserRole = role
				
				let pairs: [(String, String)] = [
					("audio_button_state",         "audio"),
					("share_button_state",         "share"),
					("filmtv_widget_state",        "filmtv"),
					("music_widget_state",         "music"),
					("stock_widget_state",         "stock"),
					("book_widget_state",          "book"),
					("research_widget_state",      "research"),
					("restaurant_widget_state",    "restaurant"),
					("politician_widget_state",    "politician"),
					("search_button_state",        "search"),
					("curator_state",              "curator"),
					("curator_card_state",         "curatorCard"),
					("voice_mode_state",           "voiceMode"),
					("video_search_state",         "videoSearch"),
					("premium_subscription_state", "premiumSubscription"),
					("home_page_state",            "homePage"),
					("art_widget_state",           "art"),
					("autoplay_state",             "autoplay")
				]
				
				DispatchQueue.main.async {
					for (key, feature) in pairs {
						let val = self.remoteConfig[key].stringValue ?? "off"
						let enabled: Bool = {
							switch val {
							case "off":     return role == "admin"
							case "testing": return role == "admin" || role == "tester"
							case "live":    return true
							default:        return false
							}
						}()
						self.setFeature(feature, enabled: enabled)
					}
					self.finishLoading()
				}
			}
		}
	}
	
	// ─────────── Timeout helpers ───────────
	private func startTimeout() {
		timeoutTask?.cancel()
		let task = DispatchWorkItem { [weak self] in
			print("Feature flag fetch timed out after \(self?.timeoutInterval ?? 0)s")
			self?.finishLoading()
		}
		timeoutTask = task
		DispatchQueue.main.asyncAfter(deadline: .now() + timeoutInterval, execute: task)
	}
	
	private func finishLoading() {
		timeoutTask?.cancel()
		if !hasLoadedRemoteFlags {
			DispatchQueue.main.async { self.hasLoadedRemoteFlags = true }
		}
	}
	
	// ─────────── Persistence ───────────
	private func setFeature(_ feature: String, enabled: Bool) {
		let ud = UserDefaults.standard
		switch feature {
		case "audio":               isAudioButtonEnabled         = enabled; ud.set(enabled, forKey: "audio_button_enabled")
		case "share":               isShareButtonEnabled         = enabled; ud.set(enabled, forKey: "share_button_enabled")
		case "filmtv":              isCinemaWidgetEnabled        = enabled; ud.set(enabled, forKey: "filmtv_widget_enabled")
		case "music":               isMusicWidgetEnabled         = enabled; ud.set(enabled, forKey: "music_widget_enabled")
		case "stock":               isStockWidgetEnabled         = enabled; ud.set(enabled, forKey: "stock_widget_enabled")
		case "book":                isBookWidgetEnabled          = enabled; ud.set(enabled, forKey: "book_widget_enabled")
		case "research":            isResearchWidgetEnabled      = enabled; ud.set(enabled, forKey: "research_widget_enabled")
		case "restaurant":          isRestaurantWidgetEnabled    = enabled; ud.set(enabled, forKey: "restaurant_widget_enabled")
		case "politician":          isPoliticianWidgetEnabled    = enabled; ud.set(enabled, forKey: "politician_widget_enabled")
		case "search":              isSearchButtonEnabled        = enabled; ud.set(enabled, forKey: "search_button_enabled")
		case "curator":             isCuratorButtonEnabled       = enabled; ud.set(enabled, forKey: "curator_button_enabled")
		case "curatorCard":         isCuratorCardButtonEnabled   = enabled; ud.set(enabled, forKey: "curator_card_button_enabled")
		case "voiceMode":           isVoiceModeEnabled           = enabled; ud.set(enabled, forKey: "voice_mode_enabled")
		case "videoSearch":         isVideoSearchEnabled         = enabled; ud.set(enabled, forKey: "video_search_enabled")
		case "premiumSubscription": isPremiumSubscriptionEnabled = enabled; ud.set(enabled, forKey: "premium_subscription_enabled")
		case "homePage":            isHomePageEnabled            = enabled; ud.set(enabled, forKey: "home_page_enabled")
		case "art":                 isArtWidgetEnabled           = enabled; ud.set(enabled, forKey: "art_widget_enabled")
		case "autoplay":            isAutoplayEnabled            = enabled; ud.set(enabled, forKey: "autoplay_enabled")
		default: break
		}
	}
}
