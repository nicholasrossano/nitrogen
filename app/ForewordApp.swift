import SwiftUI
import FirebaseCore
import FirebaseFirestore
import FirebaseCrashlytics
import UserNotifications
import Combine
import Intents
import AppIntents
import UIKit
import StoreKit
import FirebaseAnalytics

@main
struct ForewordApp: App {
	@UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
	
	init() { UIApplication.shared.beginReceivingRemoteControlEvents() }
	
	@Environment(\.scenePhase) private var scenePhase
	@StateObject private var servicesLocator = AppServicesLocator.shared
	@StateObject private var locationService = LocationService()
	@StateObject var homeViewModel          = HomeViewModel()
	
	static var sharedHomeViewModel: HomeViewModel?
	
	private static let resumeRefreshStalenessThreshold: TimeInterval = 30 * 60
	@State private var lastBackgroundDate: Date?
	@State private var isPerformingResumeRefresh = false
	@State private var resumeRefreshCancellable: AnyCancellable?
	
	var body: some Scene {
		WindowGroup {
			RootView()
				.environmentObject(servicesLocator)
				.environmentObject(locationService)
				.environmentObject(homeViewModel)
				.onAppear {
					ForewordApp.sharedHomeViewModel = homeViewModel
					NotificationManager.shared.configure(servicesLocator: servicesLocator)
					NotificationCenter.default.post(name: .forewordAppReady, object: nil)
					NotificationManager.shared.syncBadgeNow()
				}
				.onOpenURL { handleIncomingURL($0) }
				.onChange(of: scenePhase) { newPhase in
					switch newPhase {
					case .background:
						lastBackgroundDate = Date()
						Analytics.logEvent("app_backgrounded", parameters: [
							"screen": "app" as NSString
						])
						
						if !UserDefaults.standard.bool(forKey: "has_completed_first_session") {
							UserDefaults.standard.set(true, forKey: "has_completed_first_session")
							Analytics.logEvent("first_session_marked_complete", parameters: [
								"screen": "app" as NSString
							])
						}
						
					case .active:
						NotificationManager.shared.syncBadgeNow()
						performResumeRefreshIfNeeded()
					default:
						break
					}
				}
		}
	}
	
	// ─────────── Section Header ───────────
	private func performResumeRefreshIfNeeded() {
		guard let last = lastBackgroundDate else { return }
		let elapsed = Date().timeIntervalSince(last)
		guard elapsed > Self.resumeRefreshStalenessThreshold else { return }
		guard !isPerformingResumeRefresh else { return }
		
		isPerformingResumeRefresh = true
		
		let domainIDBefore = homeViewModel.selectedDomain?.id ?? ""
		let cardIDBefore   = homeViewModel.currentCard?.id ?? ""
		
		Analytics.logEvent("app_resume_refresh_start", parameters: [
			"screen": "app" as NSString,
			"domain_id": domainIDBefore as NSString,
			"card_id": cardIDBefore as NSString,
			"trigger": "resume_stale" as NSString,
			"elapsed_ms": NSNumber(value: Int(elapsed * 1000)),
			"stale_threshold_ms": NSNumber(value: Int(Self.resumeRefreshStalenessThreshold * 1000))
		])
		
		resumeRefreshCancellable?.cancel()
		var step = 0
		
		resumeRefreshCancellable = homeViewModel.$isLoading
			.removeDuplicates()
			.sink { isLoading in
				if !isLoading && step == 0 {
					step = 1
					
					let domainToRefresh = homeViewModel.selectedDomain ?? homeViewModel.domains.first
					guard let domain = domainToRefresh else {
						Analytics.logEvent("app_resume_refresh_complete", parameters: [
							"screen": "app" as NSString,
							"domain_id": domainIDBefore as NSString,
							"card_id": cardIDBefore as NSString,
							"no_domains": NSNumber(value: true)
						])
						isPerformingResumeRefresh = false
						resumeRefreshCancellable?.cancel()
						return
					}
					
					Analytics.logEvent("app_resume_cards_refresh_start", parameters: [
						"screen": "app" as NSString,
						"domain_id": domain.id as NSString
					])
					
					homeViewModel.fetchGlanceCards(for: domain)
					return
				}
				
				if !isLoading && step == 1 {
					Analytics.logEvent("app_resume_cards_refresh_complete", parameters: [
						"screen": "app" as NSString,
						"domain_id": (homeViewModel.selectedDomain?.id ?? domainIDBefore) as NSString
					])
					Analytics.logEvent("app_resume_refresh_complete", parameters: [
						"screen": "app" as NSString,
						"domain_id": (homeViewModel.selectedDomain?.id ?? domainIDBefore) as NSString,
						"card_id": (homeViewModel.currentCard?.id ?? cardIDBefore) as NSString
					])
					isPerformingResumeRefresh = false
					resumeRefreshCancellable?.cancel()
				}
			}
		
		homeViewModel.fetchFavorites()
		homeViewModel.fetchAllDomains()
	}
	
	// ─────────── Section Header ───────────
	private func handleIncomingURL(_ url: URL) {
		if url.scheme == "foreword", url.host == "curatorVoice" {
			CuratorView.nextLaunchVoice = true
			NotificationCenter.default.post(name: .voiceWidgetLaunch, object: nil)
			servicesLocator.visibilityNotifier.priorMode = servicesLocator.visibilityNotifier.mode
			servicesLocator.visibilityNotifier.mode = .curatorMode
			return
		}
		
		let comps = url.pathComponents.map { $0.lowercased() }
		
		var domainIDOverride: String? = nil
		if let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems {
			if let d = items.first(where: { $0.name.lowercased() == "domain" })?.value, !d.isEmpty {
				domainIDOverride = d
			}
		}
		
		if comps.count >= 3, comps[1] == "cards" {
			let cardID = url.pathComponents[2]
			let domainID = domainIDOverride ?? ""
			
			UserDefaults.standard.set(true, forKey: "deeplink_force_cards_view")
			NotificationCenter.default.post(
				name: .deepLinkForceCardsView,
				object: nil,
				userInfo: [
					"topic_id": domainID as NSString,
					"card_id": cardID as NSString,
					"trigger": "on_open_url_cards" as NSString
				]
			)
			Analytics.logEvent("deeplink_force_cards_view", parameters: [
				"screen": "app" as NSString,
				"topic_id": domainID as NSString,
				"card_id": cardID as NSString,
				"trigger": "on_open_url" as NSString
			])
			
			homeViewModel.handleDeepLink(domainID: domainID, cardID: cardID)
			servicesLocator.userActivityService.logAction(
				actionType: "opened_from_link",
				topicId:    domainID,
				cardId:     cardID
			)
			
			if !cardID.isEmpty {
				servicesLocator.visibilityNotifier.mode = .expandedCard
				homeViewModel.isCardExpanded = true
			}
			return
		}
		
		if comps.count >= 3, comps[1] == "domains" {
			let domainID = url.pathComponents[2]
			var cardID = ""
			if comps.count >= 5, comps[3] == "cards" {
				cardID = url.pathComponents[4]
			}
			
			UserDefaults.standard.set(true, forKey: "deeplink_force_cards_view")
			NotificationCenter.default.post(
				name: .deepLinkForceCardsView,
				object: nil,
				userInfo: [
					"topic_id": domainID as NSString,
					"card_id": cardID as NSString,
					"trigger": "on_open_url_domains" as NSString
				]
			)
			Analytics.logEvent("deeplink_force_cards_view", parameters: [
				"screen": "app" as NSString,
				"topic_id": domainID as NSString,
				"card_id": cardID as NSString,
				"trigger": "on_open_url" as NSString
			])
			
			homeViewModel.handleDeepLink(domainID: domainID, cardID: cardID)
			servicesLocator.userActivityService.logAction(
				actionType: "opened_from_link",
				topicId:    domainID,
				cardId:     cardID
			)
			
			if !cardID.isEmpty {
				servicesLocator.visibilityNotifier.mode = .expandedCard
				homeViewModel.isCardExpanded = true
			}
			return
		}
		
		print("Ignoring unsupported link: \(url.absoluteString)")
	}
}

extension Notification.Name {
	static let voiceWidgetLaunch       = Notification.Name("VoiceWidgetLaunch")
	static let forewordAppReady          = Notification.Name("ForewordAppReady")
	static let deepLinkForceCardsView  = Notification.Name("DeepLinkForceCardsView")
}
