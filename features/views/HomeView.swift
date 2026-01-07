import SwiftUI
import FirebaseAuth
import FirebaseFirestore
import Combine
import FirebaseAnalytics
import SDWebImageSwiftUI
import UIKit
import UserNotifications
import CoreLocation

// ─────────── Card Morph Namespace Env Key ───────────
private struct CardMorphNamespaceKey: EnvironmentKey {
	static let defaultValue: Namespace.ID? = nil
}
extension EnvironmentValues {
	var cardMorphNamespace: Namespace.ID? {
		get { self[CardMorphNamespaceKey.self] }
		set { self[CardMorphNamespaceKey.self] = newValue }
	}
}

// ─────────── PreferenceKeys ───────────
private struct CuratorBarHeightKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
		let n = nextValue()
		if n > 0 { value = n }
	}
}
private struct TopBarHeightKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
		let n = nextValue()
		if n > 0 { value = n }
	}
}
private struct BottomChromeHeightKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
		let n = nextValue()
		if n > 0 { value = n }
	}
}

// ─────────── HomeView ───────────
struct HomeView: View {
	var onProfileToggle: () -> Void = {}
	let selectedDomain: Domain?
	
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	@EnvironmentObject var homeViewModel: HomeViewModel
	@ObservedObject private var bannerManager = BannerManager.shared
	@StateObject private var onboarding = OnboardingManager.shared
	
	@State private var onboardingHomeFlowWasActive: Bool = false
	@State private var domainGridWasOpenAtOnboardingHomeStart: Bool = false
	
	@State private var localCurrentCard: Card?
	@State private var isLocalCardBookmarked = false
	@State private var showReportMenu       = false
	@State private var isSwipingCard        = false
	
	@State private var safeAreaInsets: EdgeInsets = .init()
	@State private var showCurator     = false
	@State private var showDomainGrid: Bool
	@State private var showDomainSelection = false
	
	@State private var didApplyLaunchDestinationPreference = false
	
	private let startOnDomainGrid: Bool
	
	private var extraTopPadding: CGFloat {
		let w = UIScreen.main.bounds.width
		let h = UIScreen.main.bounds.height
		return min(w * 0.12, h * 0.05)
	}
	
	@Namespace private var curatorPillNS
	@Namespace private var cardBubbleNS
	
	@State private var curatorBarHeight: CGFloat = 0
	@State private var measuredTopBarHeight: CGFloat = 0
	@State private var measuredBottomChromeHeight: CGFloat = 0
	
	@State private var emptyBackdropKindIndex: Int? = nil
	
	@State private var showPermissionsAlert = false
	@State private var permissionsAlertOpenedAt: CFAbsoluteTime = 0
	@StateObject private var locationPermission = LocationPermissionController()
	@State private var hasCheckedNotificationPermissionsThisSession = false
	@State private var hasAttemptedLocationRefreshThisSession = false
	@State private var hasAttemptedLocationGeohashSyncThisSession = false
	
	@State private var cachedNotificationAuthorizationStatus: UNAuthorizationStatus = .notDetermined
	@State private var cachedLocationAuthorizationStatus: CLAuthorizationStatus = .notDetermined
	
	private let locationRefreshThrottleSeconds: TimeInterval = 24 * 60 * 60
	private let lastLocationSavedAtDefaultsKey = "last_location_saved_at_unix"
	
	init(selectedDomain: Domain? = nil, onProfileToggle: @escaping () -> Void = {}) {
		self.selectedDomain   = selectedDomain
		self.onProfileToggle  = onProfileToggle
		UITabBar.appearance().backgroundColor = .clear
		
		let raw = (UserDefaults.standard.string(forKey: "launch_destination") ?? "cards").lowercased()
		let deeplinkOverride = UserDefaults.standard.bool(forKey: "deeplink_force_cards_view")
		let shouldStartOnGrid = (raw == "categories") && !deeplinkOverride
		self.startOnDomainGrid = shouldStartOnGrid
		_showDomainGrid = State(initialValue: shouldStartOnGrid)
	}
	
	var body: some View {
		ZStack {
			TourAnchorReader {
				ZStack(alignment: .top) {
					if showDomainGrid {
						DomainGridView(overlayBinding: $showDomainGrid, onProfileToggle: onProfileToggle)
							.environmentObject(servicesLocator)
							.environmentObject(homeViewModel)
							.transition(.opacity)
							.zIndex(99)
					} else {
						ZStack(alignment: .top) {
							let shouldHideBanner = (servicesLocator.visibilityNotifier.mode == .curatorMode || showDomainGrid)
							
							BannerView(bannerManager: bannerManager)
								.zIndex(3)
								.padding(.top, safeAreaInsets.top + extraTopPadding)
								.opacity(shouldHideBanner ? 0 : 1)
								.allowsHitTesting(!shouldHideBanner)
								.animation(.easeInOut(duration: 0.25), value: showDomainGrid)
							
							if !homeViewModel.domains.isEmpty {
								Color.black.ignoresSafeArea()
								
								GeometryReader { geometry in
									let fullSize = geometry.size
									
									if let domain = currentDomain {
										coreContent(domain: domain, fullSize: fullSize)
											.frame(width: fullSize.width, height: fullSize.height)
											.position(x: fullSize.width / 2, y: fullSize.height / 2)
											.transition(.opacity)
									}
									
									if showReportMenu && !showDomainGrid {
										Color.black.opacity(0.3).ignoresSafeArea()
										ReportMenu(
											isPresented: $showReportMenu,
											cardId: localCurrentCard?.id ?? ""
										)
									}
								}
								.background(
									GeometryReader { geo in
										Color.clear.onAppear { safeAreaInsets = geo.safeAreaInsets }
									}
								)
							}
							
							overlayControls
								.zIndex(2)
						}
						.transition(.opacity)
					}
					
					if showCurator { curatorSheet }
				}
				.ignoresSafeArea()
			}
		}
		.fullScreenCover(isPresented: $showDomainSelection) {
			DomainSelectionView {
				showDomainSelection = false
			}
			.environmentObject(servicesLocator)
			.environmentObject(homeViewModel)
		}
		.environmentObject(onboarding)
		.environment(\.cardMorphNamespace, cardBubbleNS)
		.onAppear {
			servicesLocator.visibilityNotifier.mode = .expandedCard
			homeViewModel.isCardExpanded = true
			homeViewModel.fetchAllDomains()
			bootStrapSelection()
			applyLaunchDestinationPreferenceIfNeeded()
			
			Analytics.logEvent("home_open", parameters: [
				"screen": "home" as NSString,
				"has_selected_domain": NSNumber(value: homeViewModel.selectedDomain != nil)
			])
			
			if startOnDomainGrid {
				Analytics.logEvent("domain_grid_open", parameters: [
					"screen": "home" as NSString
				])
			}
			
			maybeCheckNotificationPermissionsOnAppear()
			maybeSyncLocationGeohashFromUserDoc(trigger: "home_open")
			maybeRefreshAndPersistLocationIfAuthorized(trigger: "home_open", force: false)
		}
		.onReceive(NotificationCenter.default.publisher(for: .didSelectBookmarks)) { _ in
			DispatchQueue.main.async {
				let didCloseDomainGrid = NSNumber(value: self.showDomainGrid)
				let didCloseCurator = NSNumber(value: self.showCurator)
				
				Analytics.logEvent("home_switch_to_cards_for_liked", parameters: [
					"screen": "home" as NSString,
					"trigger": "notification" as NSString,
					"topic_id": (self.currentDomain?.id ?? "") as NSString,
					"card_id": (self.homeViewModel.currentCard?.id ?? self.localCurrentCard?.id ?? "") as NSString,
					"did_close_domain_grid": didCloseDomainGrid,
					"did_close_curator": didCloseCurator
				])
				
				if self.showDomainGrid || self.showCurator {
					withAnimation(.easeInOut(duration: 0.2)) {
						self.showDomainGrid = false
						self.showCurator = false
					}
				} else {
					self.showDomainGrid = false
					self.showCurator = false
				}
				
				self.servicesLocator.visibilityNotifier.mode = .expandedCard
				self.homeViewModel.isCardExpanded = true
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .deepLinkForceCardsView)) { note in
			handleDeepLinkForceCardsView(note.userInfo)
		}
		.onReceive(NotificationCenter.default.publisher(for: .triggerHomeOnboarding)) { _ in
			onboarding.reset(flow: .home)
			Analytics.logEvent("home_onboarding_triggered", parameters: [
				"screen": "home" as NSString
			])
		}
		.onReceive(NotificationCenter.default.publisher(for: .voiceWidgetLaunch)) { _ in
			withAnimation(.easeInOut(duration: 0.3)) {
				servicesLocator.visibilityNotifier.priorMode =
				servicesLocator.visibilityNotifier.mode
				servicesLocator.visibilityNotifier.mode = .curatorMode
				showCurator = true
			}
			Analytics.logEvent("curator_open", parameters: [
				"open_mode": "voice" as NSString,
				"source": "voice_widget_launch" as NSString,
				"screen": "home" as NSString
			])
		}
		.onReceive(NotificationCenter.default.publisher(for: .didCompleteOnboarding)) { _ in
			let domainCount = NSNumber(value: servicesLocator.userService.user?.domainPreferences.count ?? 0)
			Analytics.logEvent("home_reload_after_onboarding", parameters: [
				"screen": "home" as NSString,
				"domains_count": domainCount
			])
			
			homeViewModel.reloadHomeAfterDomainPreferencesChange()
			maybePresentPermissionsAlertAfterOnboardingComplete()
		}
		.onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
			handleScreenshot()
		}
		.onChange(of: homeViewModel.selectedDomain) { new in
			Analytics.logEvent("home_domain_change", parameters: [
				"screen": "home" as NSString,
				"domain_id": (new?.id ?? "unknown") as NSString,
				"domain_name": (new?.name ?? "unknown") as NSString
			])
			
			localCurrentCard = nil
			isLocalCardBookmarked = false
			homeViewModel.currentCard = nil
		}
		.onChange(of: showDomainGrid) { isOpen in
			if isOpen {
				stopMediaForCurrentCard(trigger: "domain_grid_open")
				Analytics.logEvent("domain_grid_open", parameters: [
					"screen": "home" as NSString
				])
			}
		}
		.onChange(of: showCurator) { isOpen in
			let fromExpanded = NSNumber(value: homeViewModel.isCardExpanded)
			let cid = (localCurrentCard?.id ?? "unknown") as NSString
			let did = (currentDomain?.id ?? "unknown") as NSString
			Analytics.logEvent(isOpen ? "curator_card_morph_start" : "curator_card_morph_end", parameters: [
				"screen": "home" as NSString,
				"card_id": cid,
				"domain_id": did,
				"is_from_expanded_card": fromExpanded
			])
		}
		.onChange(of: showDomainSelection) { isOpen in
			if !isOpen {
				homeViewModel.reloadHomeAfterDomainPreferencesChange()
			}
		}
		.onChange(of: onboarding.currentFlow) { newFlow in
			if newFlow == .home && !onboardingHomeFlowWasActive {
				onboardingHomeFlowWasActive = true
				domainGridWasOpenAtOnboardingHomeStart = showDomainGrid
				syncDomainGridForOnboarding(trigger: "flow_start")
				return
			}
			
			if newFlow != .home && onboardingHomeFlowWasActive {
				onboardingHomeFlowWasActive = false
				
				if !domainGridWasOpenAtOnboardingHomeStart && showDomainGrid {
					Analytics.logEvent("onboarding_domain_grid_restore_close", parameters: [
						"screen": "home" as NSString,
						"trigger": "flow_end" as NSString,
						"topic_id": (currentDomain?.id ?? "") as NSString,
						"card_id": (homeViewModel.currentCard?.id ?? localCurrentCard?.id ?? "") as NSString
					])
					withAnimation(.easeInOut(duration: 0.25)) {
						showDomainGrid = false
					}
				}
				
				domainGridWasOpenAtOnboardingHomeStart = false
			}
		}
		.onChange(of: onboarding.stepIndex) { _ in
			syncDomainGridForOnboarding(trigger: "step_change")
		}
		.navigationBarHidden(true)
		.animation(.easeInOut(duration: 0.3), value: showCurator)
		.animation(.easeInOut(duration: 0.25), value: showDomainGrid)
		.alert("Stay tuned in", isPresented: $showPermissionsAlert) {
			Button("Continue") {
				let dwell = NSNumber(value: Int((CFAbsoluteTimeGetCurrent() - permissionsAlertOpenedAt) * 1000))
				Analytics.logEvent("permissions_alert_continue", parameters: [
					"screen": "home" as NSString,
					"dwell_ms": dwell
				])
				
				showPermissionsAlert = false
				
				let trigger = "onboarding_complete"
				
				let currentLocationStatus = locationPermission.currentAuthorizationStatus()
				cachedLocationAuthorizationStatus = currentLocationStatus
				
				let shouldRequestNotifications = (cachedNotificationAuthorizationStatus == .notDetermined)
				let shouldRequestLocation = (cachedLocationAuthorizationStatus == .notDetermined)
				
				func proceedToLocation() {
					if shouldRequestLocation {
						Analytics.logEvent("location_request_start", parameters: [
							"screen": "home" as NSString,
							"trigger": trigger as NSString
						])
						locationPermission.requestWhenInUse { locStatus in
							let (isGranted, locString) = self.locationStatus(locStatus)
							Analytics.logEvent("location_request_result", parameters: [
								"screen": "home" as NSString,
								"status": locString as NSString,
								"is_granted": NSNumber(value: isGranted)
							])
							
							guard isGranted else { return }
							
							maybeSyncLocationGeohashFromUserDoc(trigger: trigger)
							maybeRefreshAndPersistLocationIfAuthorized(trigger: trigger, force: true)
						}
					} else {
						let (isGranted, locString) = self.locationStatus(cachedLocationAuthorizationStatus)
						Analytics.logEvent("location_request_skip", parameters: [
							"screen": "home" as NSString,
							"trigger": trigger as NSString,
							"status": locString as NSString,
							"reason": "already_determined" as NSString
						])
						
						guard isGranted else { return }
						maybeSyncLocationGeohashFromUserDoc(trigger: trigger)
						maybeRefreshAndPersistLocationIfAuthorized(trigger: trigger, force: false)
					}
				}
				
				if shouldRequestNotifications {
					requestNotifications { granted, status in
						Analytics.logEvent("notifications_request_result", parameters: [
							"screen": "home" as NSString,
							"granted": NSNumber(value: granted),
							"status": self.notificationStatusString(status) as NSString
						])
						proceedToLocation()
					}
				} else {
					Analytics.logEvent("notifications_request_skip", parameters: [
						"screen": "home" as NSString,
						"trigger": trigger as NSString,
						"status": self.notificationStatusString(cachedNotificationAuthorizationStatus) as NSString,
						"reason": "already_determined" as NSString
					])
					
					if cachedNotificationAuthorizationStatus == .authorized || cachedNotificationAuthorizationStatus == .provisional {
						UIApplication.shared.registerForRemoteNotifications()
					}
					
					proceedToLocation()
				}
			}
			Button("Not now", role: .cancel) {
				let dwell = NSNumber(value: Int((CFAbsoluteTimeGetCurrent() - permissionsAlertOpenedAt) * 1000))
				Analytics.logEvent("permissions_alert_skip", parameters: [
					"screen": "home" as NSString,
					"dwell_ms": dwell
				])
				showPermissionsAlert = false
			}
		} message: {
			Text("""
   If you allow notifications and location, we will:
   
   • Send you notifications with top recommended cards for you.
   • Use your location to personalize local recommendations.
   """)
		}
	}
	
	private var currentDomain: Domain? {
		homeViewModel.selectedDomain ?? homeViewModel.activeDomains.first
	}
	
	private var currentDomainIndex: Int {
		homeViewModel.activeDomains.firstIndex(where: { $0.id == currentDomain?.id }) ?? 0
	}
	
	// ─────────── Onboarding helpers ───────────
	private func onboardingCurrentStepId() -> String? {
		guard let flow = onboarding.currentFlow else { return nil }
		guard let steps = onboarding.flows[flow], onboarding.stepIndex < steps.count else { return nil }
		return steps[onboarding.stepIndex].id
	}
	
	private func syncDomainGridForOnboarding(trigger: String) {
		guard onboarding.currentFlow == .home else { return }
		guard let stepId = onboardingCurrentStepId() else { return }
		
		let wantsDomainGrid = stepId.hasPrefix("domain_grid_")
		
		if wantsDomainGrid {
			let didCloseCurator = NSNumber(value: showCurator)
			if showCurator {
				withAnimation(.easeInOut(duration: 0.25)) {
					showCurator = false
				}
			}
			
			guard !showDomainGrid else { return }
			
			Analytics.logEvent("onboarding_domain_grid_auto_open", parameters: [
				"screen": "home" as NSString,
				"trigger": trigger as NSString,
				"step_id": stepId as NSString,
				"topic_id": (currentDomain?.id ?? "") as NSString,
				"card_id": (homeViewModel.currentCard?.id ?? localCurrentCard?.id ?? "") as NSString,
				"did_close_curator": didCloseCurator
			])
			
			withAnimation(.easeInOut(duration: 0.25)) {
				showDomainGrid = true
			}
			return
		}
		
		guard showDomainGrid else { return }
		
		Analytics.logEvent("onboarding_domain_grid_auto_close", parameters: [
			"screen": "home" as NSString,
			"trigger": trigger as NSString,
			"step_id": stepId as NSString,
			"topic_id": (currentDomain?.id ?? "") as NSString,
			"card_id": (homeViewModel.currentCard?.id ?? localCurrentCard?.id ?? "") as NSString
		])
		
		withAnimation(.easeInOut(duration: 0.25)) {
			showDomainGrid = false
		}
	}
	
	// ─────────── Deep link override ───────────
	private func handleDeepLinkForceCardsView(_ userInfo: [AnyHashable: Any]?) {
		DispatchQueue.main.async {
			let rawLaunch = (UserDefaults.standard.string(forKey: "launch_destination") ?? "cards").lowercased()
			let wasCategories = NSNumber(value: rawLaunch == "categories")
			
			let topicId = (userInfo?["topic_id"] as? NSString) ?? ((self.currentDomain?.id ?? "") as NSString)
			let cardId = (userInfo?["card_id"] as? NSString) ?? ((self.homeViewModel.currentCard?.id ?? self.localCurrentCard?.id ?? "") as NSString)
			let trigger = (userInfo?["trigger"] as? NSString) ?? ("deeplink" as NSString)
			
			Analytics.logEvent("deeplink_override_launch_destination", parameters: [
				"screen": "home" as NSString,
				"trigger": trigger,
				"topic_id": topicId,
				"card_id": cardId,
				"was_categories": wasCategories,
				"did_close_domain_grid": NSNumber(value: self.showDomainGrid),
				"did_close_curator": NSNumber(value: self.showCurator)
			])
			
			UserDefaults.standard.set(false, forKey: "deeplink_force_cards_view")
			
			if self.showDomainGrid || self.showCurator {
				withAnimation(.easeInOut(duration: 0.2)) {
					self.showDomainGrid = false
					self.showCurator = false
				}
			} else {
				self.showDomainGrid = false
				self.showCurator = false
			}
			
			self.servicesLocator.visibilityNotifier.mode = .expandedCard
			self.homeViewModel.isCardExpanded = true
		}
	}
	
	// ─────────── Launch destination ───────────
	private func applyLaunchDestinationPreferenceIfNeeded() {
		guard !didApplyLaunchDestinationPreference else { return }
		didApplyLaunchDestinationPreference = true
		
		if UserDefaults.standard.bool(forKey: "deeplink_force_cards_view") {
			let rawLaunch = (UserDefaults.standard.string(forKey: "launch_destination") ?? "cards").lowercased()
			let wasCategories = NSNumber(value: rawLaunch == "categories")
			
			let didCloseDomainGrid = NSNumber(value: showDomainGrid)
			let didCloseCurator = NSNumber(value: showCurator)
			
			Analytics.logEvent("launch_destination_suppressed_for_deeplink", parameters: [
				"screen": "home" as NSString,
				"trigger": "deeplink" as NSString,
				"topic_id": (currentDomain?.id ?? "") as NSString,
				"card_id": (homeViewModel.currentCard?.id ?? localCurrentCard?.id ?? "") as NSString,
				"was_categories": wasCategories,
				"did_close_domain_grid": didCloseDomainGrid,
				"did_close_curator": didCloseCurator
			])
			
			if showDomainGrid || showCurator {
				withAnimation(.easeInOut(duration: 0.2)) {
					showDomainGrid = false
					showCurator = false
				}
			} else {
				showDomainGrid = false
				showCurator = false
			}
			
			servicesLocator.visibilityNotifier.mode = .expandedCard
			homeViewModel.isCardExpanded = true
			
			UserDefaults.standard.set(false, forKey: "deeplink_force_cards_view")
			return
		}
		
		let raw = (UserDefaults.standard.string(forKey: "launch_destination") ?? "cards").lowercased()
		guard raw == "categories" else { return }
		guard !showDomainGrid else { return }
		guard !showCurator else { return }
		
		DispatchQueue.main.async {
			guard !UserDefaults.standard.bool(forKey: "deeplink_force_cards_view") else { return }
			guard !showDomainGrid else { return }
			guard !showCurator else { return }
			showDomainGrid = true
		}
	}
	
	// ─────────── Section Header ───────────
	private func coreContent(domain: Domain, fullSize: CGSize) -> some View {
		GeometryReader { geometry in
			let w  = geometry.size.width
			let h  = geometry.size.height
			let safeW = w - geometry.safeAreaInsets.leading - geometry.safeAreaInsets.trailing
			let safeH = h - geometry.safeAreaInsets.top    - geometry.safeAreaInsets.bottom
			
			let cardTopGap: CGFloat = safeW * 0.02
			let cardBottomGap: CGFloat = safeW * 0.02
			
			let stackHeight = max(0, safeH
								  - measuredTopBarHeight
								  - measuredBottomChromeHeight
								  - cardTopGap
								  - cardBottomGap)
			
			let homeAssetName = (domain.id.lowercased() == "home" || domain.name.lowercased() == "home") ? HomeImageSelector.selected : nil
			
			ZStack {
				ZStack {
					if domain.id == SpecialDomainID.bookmarks {
						Image("Bookmarks")
							.resizable()
							.aspectRatio(contentMode: .fill)
							.frame(width: w, height: h)
							.clipped()
					} else if domain.id.lowercased() == "home" || domain.name.lowercased() == "home" || domain.name.lowercased() == "for you" {
						if let asset = homeAssetName {
							Image(asset)
								.resizable()
								.aspectRatio(contentMode: .fill)
								.frame(width: w, height: h)
								.clipped()
						} else if let urlString = domain.imageUrl, let url = URL(string: urlString) {
							WebImage(url: url)
								.resizable()
								.indicator(.activity)
								.aspectRatio(contentMode: .fill)
								.frame(width: w, height: h)
								.clipped()
						} else {
							Color.gray.frame(width: w, height: h)
						}
					} else if let urlString = domain.imageUrl, let url = URL(string: urlString) {
						WebImage(url: url)
							.resizable()
							.indicator(.activity)
							.aspectRatio(contentMode: .fill)
							.frame(width: w, height: h)
							.clipped()
					} else {
						Color.gray.frame(width: w, height: h)
					}
					
					LinearGradient(
						gradient: Gradient(colors: [Color.black.opacity(0.5), Color.black.opacity(0.2)]),
						startPoint: .top,
						endPoint: .bottom
					)
				}
				.contentShape(Rectangle())
				.simultaneousGesture(
					DragGesture(minimumDistance: 20).onEnded { value in
						guard
							domain.id == SpecialDomainID.bookmarks,
							servicesLocator.visibilityNotifier.mode == .normal,
							abs(value.translation.width) > abs(value.translation.height),
							value.translation.width < -50
						else { return }
						withAnimation(.easeInOut(duration: 0.2)) { homeViewModel.hideBookmarks() }
					}
				)
				
				EmptyStackIcon()
					.opacity((servicesLocator.visibilityNotifier.isWidgetVisible(.emptyStackIcon) && !showDomainGrid) ? 1 : 0)
					.animation(.easeInOut(duration: 0.25), value: showDomainGrid)
					.animation(.easeInOut(duration: 0.3), value: servicesLocator.visibilityNotifier.mode)
				
				dynamicBlur()
				
				VStack(spacing: 0) {
					Spacer(minLength: measuredTopBarHeight + cardTopGap)
					
					GeometryReader { innerGeo in
						ZStack {
							swipeableStack(
								width: safeW,
								height: stackHeight,
								maxCardHeight: stackHeight,
								domain: domain
							)
							.disabled(servicesLocator.visibilityNotifier.mode == .zoomedArtwork)
							.opacity(servicesLocator.visibilityNotifier.isWidgetVisible(.swipeableStack) ? 1 : 0)
							.animation(.easeInOut(duration: 0.2), value: servicesLocator.visibilityNotifier.mode)
						}
						.frame(width: innerGeo.size.width, height: stackHeight)
						.mask(Rectangle().scaleEffect(x: 1, y: 1000, anchor: .center))
					}
					.frame(height: stackHeight)
					
					Spacer(minLength: measuredBottomChromeHeight + cardBottomGap)
				}
				.opacity(showDomainGrid ? 0 : 1)
				.animation(.easeInOut(duration: 0.25), value: showDomainGrid)
			}
		}
		.edgesIgnoringSafeArea(.all)
	}
	
	// ─────────── Section Header ───────────
	@ViewBuilder
	private func dynamicBlur() -> some View {
		BlurView(style: .systemUltraThinMaterial, intensity: 0)
			.ignoresSafeArea()
			.allowsHitTesting(false)
			.animation(.easeInOut(duration: 0.2), value: servicesLocator.visibilityNotifier.mode)
	}
	
	// ─────────── Section Header ───────────
	@ViewBuilder
	private func loadingPlaceholders(expandedItemWidth: CGFloat, maxCardHeight: CGFloat, domainName: String) -> some View {
		ZStack {
			ForEach(0..<3, id: \.self) { i in
				GlanceCard(
					card: nil,
					isExpanded: true,
					onTap: {},
					isTopCard: i == 0,
					hideActionBar: false,
					topicName: domainName,
					isBookmarked: $isLocalCardBookmarked,
					updateBookmarkCache: { _, _ in }
				)
				.frame(width: expandedItemWidth, height: maxCardHeight)
			}
		}
		.overlay(alignment: .center) {
			Color.clear
				.frame(width: expandedItemWidth, height: maxCardHeight)
				.allowsHitTesting(false)
				.tourTag("home_card")
		}
	}
	
	// ─────────── Section Header ───────────
	@ViewBuilder
	private func swipeableStack(
		width safeW: CGFloat,
		height stackH: CGFloat,
		maxCardHeight: CGFloat,
		domain: Domain
	) -> some View {
		GeometryReader { cardGeometry in
			let expandedItemWidth = UIScreen.main.bounds.width * 0.93
			
			ZStack {
				if let cardsArray = homeViewModel.glanceCards[domain.name] {
					if !cardsArray.isEmpty {
						let binding = Binding<[Card]>(
							get: { homeViewModel.glanceCards[domain.name] ?? [] },
							set: { homeViewModel.glanceCards[domain.name] = $0 }
						)
						
						SwipeableStack(
							cards: binding,
							onSwipeCompleted: { idx, direction, _ in
								if let swipedCard = homeViewModel.glanceCards[domain.name]?[idx] {
									homeViewModel.handleCardSwipe(card: swipedCard, direction: direction)
								}
							},
							servicesLocator: servicesLocator,
							showReportMenu: $showReportMenu,
							onCardChanged: { handleCardChange($0, domain: domain) },
							topicName: domain.name,
							showCurator: $showCurator,
							isBookmarked: $isLocalCardBookmarked,
							updateBookmarkCache: { id, val in
								homeViewModel.bookmarkStatuses[id] = val
							},
							isSwipingCard: $isSwipingCard,
							shelfPreviewFocusRequest: $homeViewModel.shelfPreviewFocusRequest
						)
						.disabled(servicesLocator.visibilityNotifier.mode == .zoomedArtwork)
						
					} else {
						if homeViewModel.isLoading {
							loadingPlaceholders(
								expandedItemWidth: expandedItemWidth,
								maxCardHeight: maxCardHeight,
								domainName: domain.name
							)
							.frame(width: cardGeometry.size.width, height: cardGeometry.size.height)
						} else {
							emptyStackView(domain: domain)
								.frame(width: cardGeometry.size.width, height: cardGeometry.size.height)
						}
					}
				} else {
					loadingPlaceholders(
						expandedItemWidth: expandedItemWidth,
						maxCardHeight: maxCardHeight,
						domainName: domain.name
					)
					.frame(width: cardGeometry.size.width, height: cardGeometry.size.height)
				}
			}
			.frame(width: cardGeometry.size.width, height: cardGeometry.size.height)
			.position(x: cardGeometry.size.width / 2, y: cardGeometry.size.height / 2)
		}
	}
	
	// ─────────── Section Header ───────────
	private func handleCardChange(_ newCard: Card, domain: Domain) {
		localCurrentCard = newCard
		homeViewModel.currentCard = newCard
		
		homeViewModel.maybePrefetchIfNeeded(domain: domain, currentCardId: newCard.id, threshold: 5)
		
		NotificationCenter.default.post(name: Notification.Name("StopMusicPreview"), object: nil)
		maybeTriggerAutoplayMedia(for: newCard, domain: domain)
		
		if let cached = homeViewModel.bookmarkStatuses[newCard.id] {
			isLocalCardBookmarked = cached
		} else {
			servicesLocator.bookmarksService.isCardBookmarked(cardId: newCard.id) { isBk in
				DispatchQueue.main.async {
					homeViewModel.bookmarkStatuses[newCard.id] = isBk
					isLocalCardBookmarked = isBk
				}
			}
		}
	}
	
	private func stopMediaForCurrentCard(trigger: String) {
		NotificationCenter.default.post(name: Notification.Name("StopMusicPreview"), object: nil)
		
		guard let cardId = homeViewModel.currentCard?.id ?? localCurrentCard?.id else { return }
		NotificationCenter.default.post(
			name: .stopInlineVideoForCard,
			object: nil,
			userInfo: [
				"cardID": cardId,
				"trigger": trigger,
				"defer_ui_close_ms": 0
			]
		)
	}
	
	// ─────────── Section Header ───────────
	private func maybeTriggerAutoplayMedia(for card: Card, domain: Domain) {
		let key = "autoplay_media_enabled"
		let autoplayEnabled: Bool = {
			if let obj = UserDefaults.standard.object(forKey: key) as? Bool {
				return obj
			}
			return true
		}()
		
		Analytics.logEvent("home_autoplay_media_signal", parameters: [
			"screen": "home" as NSString,
			"card_id": card.id as NSString,
			"domain_id": domain.id as NSString,
			"trigger": "card_change" as NSString,
			"enabled": NSNumber(value: autoplayEnabled)
		])
		
		guard autoplayEnabled else { return }
		
		let delays: [Double] = [0.05, 0.30]
		for (idx, d) in delays.enumerated() {
			DispatchQueue.main.asyncAfter(deadline: .now() + d) {
				Analytics.logEvent("home_autoplay_media_post", parameters: [
					"screen": "home" as NSString,
					"card_id": card.id as NSString,
					"domain_id": domain.id as NSString,
					"trigger": "card_change" as NSString,
					"attempt": NSNumber(value: idx + 1)
				])
				
				NotificationCenter.default.post(
					name: .autoPlayMediaForCard,
					object: nil,
					userInfo: [
						"cardID": card.id,
						"attempt": idx + 1
					]
				)
			}
		}
	}
	
	// ─────────── Section Header ───────────
	private var overlayControls: some View {
		GeometryReader { geo in
			let w     = geo.size.width
			let hPad  = w * 0.047
			let bPad  = w * 0.05
			let _     = currentDomainIndex
			
			let navHeight: CGFloat = (curatorBarHeight > 0) ? curatorBarHeight : 40
			
			VStack(alignment: .trailing, spacing: 12) {
				Color.clear
					.frame(height: safeAreaInsets.top + extraTopPadding + 6)
					.background(
						GeometryReader { proxy in
							Color.clear.preference(key: TopBarHeightKey.self, value: proxy.size.height)
						}
					)
				
				Spacer()
				
				HStack(spacing: 8) {
					NavigationCapsule(
						showDomainGrid: $showDomainGrid,
						onProfileToggle: onProfileToggle,
						height: navHeight
					)
					.environmentObject(homeViewModel)
					.tourTag("home_nav_capsule")
					
					CuratorInputBar(
						showCurator: $showCurator,
						associatedCard: localCurrentCard
					)
					.curatorPillMatched(in: curatorPillNS)
					.background(
						GeometryReader { proxy in
							Color.clear.preference(key: CuratorBarHeightKey.self, value: proxy.size.height)
						}
					)
				}
				.opacity(showCurator ? 0 : 1)
				.padding(.bottom, safeAreaInsets.bottom + bPad)
				.padding(.horizontal, hPad)
				.background(
					GeometryReader { proxy in
						Color.clear.preference(key: BottomChromeHeightKey.self, value: proxy.size.height)
					}
				)
			}
			.onPreferenceChange(CuratorBarHeightKey.self) { curatorBarHeight = $0 }
			.onPreferenceChange(TopBarHeightKey.self) { measuredTopBarHeight = $0 }
			.onPreferenceChange(BottomChromeHeightKey.self) { measuredBottomChromeHeight = $0 }
		}
		.opacity((servicesLocator.visibilityNotifier.mode == .curatorMode || showDomainGrid) ? 0 : 1)
		.allowsHitTesting(servicesLocator.visibilityNotifier.mode != .curatorMode && !showDomainGrid)
		.animation(.easeInOut(duration: 0.25), value: showDomainGrid)
	}
	
	private var curatorSheet: some View {
		CuratorView(
			onDismiss: {
				withAnimation(.easeInOut(duration: 0.3)) {
					servicesLocator.visibilityNotifier.mode =
					servicesLocator.visibilityNotifier.priorMode
				}
				showCurator = false
			},
			initialCard: localCurrentCard,
			pillNamespace: curatorPillNS
		)
		.id(localCurrentCard?.id ?? "curator-no-card")
		.transition(.opacity)
		.zIndex(4)
	}
	
	private func bootStrapSelection() {
		if let sel = selectedDomain {
			homeViewModel.selectedDomain = sel
		} else if homeViewModel.selectedDomain == nil {
			homeViewModel.selectedDomain = homeViewModel.activeDomains.first
		}
	}
}

// MARK: - Empty Stack UI
extension HomeView {
	// ─────────── Section Header ───────────
	@ViewBuilder
	private func emptyStackView(domain: Domain) -> some View {
		GeometryReader { geo in
			VStack(spacing: -10) {
				LoadingBackdropView(kindIndex: emptyBackdropKindIndex)
					.frame(width: geo.size.width, height: geo.size.width)
					.offset(y: -geo.size.height * 0.05)
					.onAppear {
						if emptyBackdropKindIndex == nil {
							emptyBackdropKindIndex = Int.random(in: 0..<4)
						}
						Analytics.logEvent("home_empty_stack_shown", parameters: [
							"screen": "home" as NSString,
							"domain_id": domain.id as NSString,
							"domain_name": domain.name as NSString
						])
					}
					.onDisappear {
						emptyBackdropKindIndex = nil
					}
				
				Button {
					UIImpactFeedbackGenerator(style: .light).impactOccurred()
					
					Analytics.logEvent("home_empty_stack_cta_tap", parameters: [
						"screen": "home" as NSString,
						"domain_id": domain.id as NSString,
						"domain_name": domain.name as NSString,
						"trigger": "tap" as NSString
					])
					
					Analytics.logEvent("domain_grid_open_from_empty", parameters: [
						"screen": "home" as NSString
					])
					
					showDomainGrid = true
				} label: {
					HStack(spacing: 8) {
						Image(systemName: "square.grid.2x2.fill")
							.font(.system(size: 16, weight: .semibold))
						Text("Explore more")
							.font(.custom("Avenir", size: 16))
					}
					.foregroundColor(.white)
					.padding(.horizontal, 16)
					.padding(.vertical, 10)
					.background(
						Group {
							if #available(iOS 26.0, *) {
								Capsule().glassEffect()
							} else {
								Capsule()
									.fill(.ultraThinMaterial)
									.overlay(Capsule().stroke(.white.opacity(0.7), lineWidth: 0.5))
							}
						}
					)
				}
				.buttonStyle(PressScaleStyle())
				.accessibilityLabel("Explore more")
			}
			.frame(width: geo.size.width, height: geo.size.height, alignment: .center)
			.opacity(showDomainGrid ? 0 : 1)
			.animation(.easeInOut(duration: 0.25), value: showDomainGrid)
		}
	}
}

// MARK: - Permissions helpers
extension HomeView {
	// ─────────── Section Header ───────────
	private func requestNotifications(completion: @escaping (Bool, UNAuthorizationStatus) -> Void) {
		Analytics.logEvent("notifications_request_start", parameters: [
			"screen": "home" as NSString,
			"trigger": "onboarding_complete" as NSString
		])
		UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
			UNUserNotificationCenter.current().getNotificationSettings { settings in
				if granted {
					DispatchQueue.main.async {
						UIApplication.shared.registerForRemoteNotifications()
					}
				}
				DispatchQueue.main.async {
					completion(granted, settings.authorizationStatus)
				}
			}
		}
	}
	
	// ─────────── Section Header ───────────
	private func maybeCheckNotificationPermissionsOnAppear() {
		guard !hasCheckedNotificationPermissionsThisSession else { return }
		hasCheckedNotificationPermissionsThisSession = true
		
		if onboarding.currentFlow != nil { return }
		
		let locStatus = locationPermission.currentAuthorizationStatus()
		cachedLocationAuthorizationStatus = locStatus
		
		UNUserNotificationCenter.current().getNotificationSettings { settings in
			let notifStatus = settings.authorizationStatus
			DispatchQueue.main.async {
				cachedNotificationAuthorizationStatus = notifStatus
			}
			
			switch notifStatus {
			case .authorized, .provisional:
				DispatchQueue.main.async {
					UIApplication.shared.registerForRemoteNotifications()
				}
			case .notDetermined:
				DispatchQueue.main.async {
					permissionsAlertOpenedAt = CFAbsoluteTimeGetCurrent()
					Analytics.logEvent("permissions_alert_open", parameters: [
						"screen": "home" as NSString,
						"trigger": "home_open" as NSString
					])
					showPermissionsAlert = true
				}
			default:
				break
			}
		}
	}
	
	// ─────────── Section Header ───────────
	private func maybePresentPermissionsAlertAfterOnboardingComplete() {
		let trigger = "onboarding_complete"
		
		let locStatus = locationPermission.currentAuthorizationStatus()
		cachedLocationAuthorizationStatus = locStatus
		
		UNUserNotificationCenter.current().getNotificationSettings { settings in
			let notifStatus = settings.authorizationStatus
			let locTuple = self.locationStatus(locStatus)
			let locString = locTuple.1
			let notifString = self.notificationStatusString(notifStatus)
			
			DispatchQueue.main.async {
				self.cachedNotificationAuthorizationStatus = notifStatus
				
				let shouldShow = (notifStatus == .notDetermined) || (locStatus == .notDetermined)
				guard shouldShow else {
					Analytics.logEvent("permissions_alert_skip_show", parameters: [
						"screen": "home" as NSString,
						"trigger": trigger as NSString,
						"notifications_status": notifString as NSString,
						"location_status": locString as NSString
					])
					return
				}
				
				self.permissionsAlertOpenedAt = CFAbsoluteTimeGetCurrent()
				Analytics.logEvent("permissions_alert_open", parameters: [
					"screen": "home" as NSString,
					"trigger": trigger as NSString,
					"notifications_status": notifString as NSString,
					"location_status": locString as NSString
				])
				self.showPermissionsAlert = true
			}
		}
	}
	
	// ─────────── Section Header ───────────
	private func notificationStatusString(_ status: UNAuthorizationStatus) -> String {
		switch status {
		case .authorized: return "authorized"
		case .provisional: return "provisional"
		case .denied: return "denied"
		case .ephemeral: return "ephemeral"
		case .notDetermined: return "not_determined"
		@unknown default: return "unknown"
		}
	}
	
	// ─────────── Section Header ───────────
	private func locationStatus(_ status: CLAuthorizationStatus) -> (Bool, String) {
		switch status {
		case .authorizedAlways: return (true, "authorized_always")
		case .authorizedWhenInUse: return (true, "authorized_when_in_use")
		case .denied: return (false, "denied")
		case .restricted: return (false, "restricted")
		case .notDetermined: return (false, "not_determined")
		@unknown default: return (false, "unknown")
		}
	}
	
	// ─────────── Section Header ───────────
	private func isLocationRefreshThrottled() -> Bool {
		if let last = servicesLocator.userService.user?.locationUpdatedAt {
			if Date().timeIntervalSince(last) < locationRefreshThrottleSeconds {
				return true
			}
		}
		
		let ts = UserDefaults.standard.double(forKey: lastLocationSavedAtDefaultsKey)
		if ts > 0 {
			let last = Date(timeIntervalSince1970: ts)
			if Date().timeIntervalSince(last) < locationRefreshThrottleSeconds {
				return true
			}
		}
		
		return false
	}
	
	// ─────────── Section Header ───────────
	private func maybeRefreshAndPersistLocationIfAuthorized(trigger: String, force: Bool) {
		guard !hasAttemptedLocationRefreshThisSession || force else { return }
		hasAttemptedLocationRefreshThisSession = true
		
		let status = locationPermission.currentAuthorizationStatus()
		let (isGranted, statusString) = self.locationStatus(status)
		guard isGranted else {
			Analytics.logEvent("location_refresh_skip", parameters: [
				"screen": "home" as NSString,
				"domain_id": (currentDomain?.id ?? "unknown") as NSString,
				"card_id": (localCurrentCard?.id ?? "unknown") as NSString,
				"trigger": trigger as NSString,
				"reason": "not_authorized" as NSString,
				"status": statusString as NSString
			])
			return
		}
		
		if !force, isLocationRefreshThrottled() {
			Analytics.logEvent("location_refresh_skip", parameters: [
				"screen": "home" as NSString,
				"domain_id": (currentDomain?.id ?? "unknown") as NSString,
				"card_id": (localCurrentCard?.id ?? "unknown") as NSString,
				"trigger": trigger as NSString,
				"reason": "throttled" as NSString
			])
			return
		}
		
		Analytics.logEvent("location_capture_start", parameters: [
			"screen": "home" as NSString,
			"domain_id": (currentDomain?.id ?? "unknown") as NSString,
			"card_id": (localCurrentCard?.id ?? "unknown") as NSString,
			"trigger": trigger as NSString
		])
		
		locationPermission.requestOneShotLocation { location, placemark in
			let hasLocation = NSNumber(value: location != nil)
			let accuracy = NSNumber(value: Int(max(0, location?.horizontalAccuracy ?? 0)))
			
			Analytics.logEvent("location_capture_result", parameters: [
				"screen": "home" as NSString,
				"domain_id": (currentDomain?.id ?? "unknown") as NSString,
				"card_id": (localCurrentCard?.id ?? "unknown") as NSString,
				"trigger": trigger as NSString,
				"has_location": hasLocation,
				"accuracy_m": accuracy
			])
			
			persistUserLocation(location: location, placemark: placemark, trigger: trigger)
		}
	}
	
	// ─────────── Section Header ───────────
	private func persistUserLocation(location: CLLocation?, placemark: CLPlacemark?, trigger: String) {
		guard let uid = Auth.auth().currentUser?.uid else { return }
		guard let location = location else {
			Analytics.logEvent("user_location_save_complete", parameters: [
				"screen": "home" as NSString,
				"domain_id": (currentDomain?.id ?? "unknown") as NSString,
				"card_id": (localCurrentCard?.id ?? "unknown") as NSString,
				"trigger": trigger as NSString,
				"ok": NSNumber(value: false),
				"reason": "no_location" as NSString
			])
			return
		}
		
		let roundedLatitude = (location.coordinate.latitude * 1000).rounded() / 1000
		let roundedLongitude = (location.coordinate.longitude * 1000).rounded() / 1000
		let accuracyMeters = max(0, location.horizontalAccuracy)
		
		let geohash = Geohash.encode(latitude: roundedLatitude, longitude: roundedLongitude, precision: 9)
		let geopoint = GeoPoint(latitude: roundedLatitude, longitude: roundedLongitude)
		
		let locality = placemark?.locality ?? ""
		let administrativeArea = placemark?.administrativeArea ?? ""
		let countryCode = placemark?.isoCountryCode ?? ""
		
		Analytics.logEvent("user_location_save_start", parameters: [
			"screen": "home" as NSString,
			"domain_id": (currentDomain?.id ?? "unknown") as NSString,
			"card_id": (localCurrentCard?.id ?? "unknown") as NSString,
			"trigger": trigger as NSString,
			"geohash_len": NSNumber(value: geohash.count)
		])
		
		let payload: [String: Any] = [
			"locationLatitude": NSNumber(value: roundedLatitude),
			"locationLongitude": NSNumber(value: roundedLongitude),
			"locationAccuracyMeters": NSNumber(value: accuracyMeters),
			"locationLocality": locality as NSString,
			"locationAdministrativeArea": administrativeArea as NSString,
			"locationCountryCode": countryCode as NSString,
			"locationGeohash": geohash as NSString,
			"locationGeopoint": geopoint,
			"locationUpdatedAt": FieldValue.serverTimestamp()
		]
		
		Firestore.firestore()
			.collection("users")
			.document(uid)
			.setData(payload, merge: true) { _ in
				UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastLocationSavedAtDefaultsKey)
			}
	}
	
	// ─────────── Section Header ───────────
	private func maybeSyncLocationGeohashFromUserDoc(trigger: String) {
		guard !hasAttemptedLocationGeohashSyncThisSession else { return }
		hasAttemptedLocationGeohashSyncThisSession = true
		guard let uid = Auth.auth().currentUser?.uid else { return }
		
		Analytics.logEvent("location_geohash_sync_start", parameters: [
			"screen": "home" as NSString,
			"trigger": trigger as NSString
		])
		
		let ref = Firestore.firestore().collection("users").document(uid)
		ref.getDocument { snap, err in
			if err != nil { return }
			guard let d = snap?.data() else { return }
			
			let lat = d["locationLatitude"] as? Double
			let lon = d["locationLongitude"] as? Double
			let existing = d["locationGeohash"] as? String
			
			guard let lat, let lon else { return }
			
			let roundedLat = (lat * 1000).rounded() / 1000
			let roundedLon = (lon * 1000).rounded() / 1000
			let computed = Geohash.encode(latitude: roundedLat, longitude: roundedLon, precision: 9)
			
			if let existing, !existing.isEmpty, existing == computed, d["locationGeopoint"] != nil {
				return
			}
			
			let payload: [String: Any] = [
				"locationGeohash": computed as NSString,
				"locationGeopoint": GeoPoint(latitude: roundedLat, longitude: roundedLon)
			]
			
			ref.setData(payload, merge: true) { _ in }
		}
	}
	
	// ─────────── Section Header ───────────
	private func handleScreenshot() {
		guard onboarding.currentFlow == nil else { return }
		guard localCurrentCard != nil else { return }
		guard !showCurator && !showDomainGrid else { return }
		
		Analytics.logEvent("home_screenshot_capture", parameters: [
			"screen": "home" as NSString,
			"domain_id": (currentDomain?.id ?? "unknown") as NSString,
			"domain_name": (currentDomain?.name ?? "unknown") as NSString,
			"card_id": (localCurrentCard?.id ?? "unknown") as NSString
		])
		
		onboarding.start(flow: .shareUpdate)
	}
}

// ─────────── LocationPermissionController ───────────
final class LocationPermissionController: NSObject, ObservableObject, CLLocationManagerDelegate {
	private let manager = CLLocationManager()
	private var completions: [(CLAuthorizationStatus) -> Void] = []
	private var locationCompletions: [(CLLocation?, CLPlacemark?) -> Void] = []
	private var isResolvingPlacemark: Bool = false
	
	override init() {
		super.init()
		manager.delegate = self
		manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
	}
	
	// ─────────── Section Header ───────────
	func currentAuthorizationStatus() -> CLAuthorizationStatus {
		manager.authorizationStatus
	}
	
	// ─────────── Section Header ───────────
	func requestWhenInUse(completion: @escaping (CLAuthorizationStatus) -> Void) {
		completions.append(completion)
		let status = manager.authorizationStatus
		if status == .notDetermined {
			manager.requestWhenInUseAuthorization()
		} else {
			flush(status)
		}
	}
	
	// ─────────── Section Header ───────────
	func requestOneShotLocation(completion: @escaping (CLLocation?, CLPlacemark?) -> Void) {
		let status = manager.authorizationStatus
		switch status {
		case .authorizedAlways, .authorizedWhenInUse:
			locationCompletions.append(completion)
			manager.requestLocation()
		default:
			completion(nil, nil)
		}
	}
	
	// ─────────── Section Header ───────────
	func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
		flush(manager.authorizationStatus)
	}
	
	// ─────────── Section Header ───────────
	func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
		guard let location = locations.last else {
			flushLocation(nil, nil)
			return
		}
		
		guard !isResolvingPlacemark else { return }
		isResolvingPlacemark = true
		
		CLGeocoder().reverseGeocodeLocation(location) { [weak self] placemarks, _ in
			guard let self = self else { return }
			self.isResolvingPlacemark = false
			self.flushLocation(location, placemarks?.first)
		}
	}
	
	// ─────────── Section Header ───────────
	func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
		flushLocation(nil, nil)
	}
	
	// ─────────── Section Header ───────────
	private func flush(_ status: CLAuthorizationStatus) {
		let cbs = completions
		completions.removeAll()
		for cb in cbs { cb(status) }
	}
	
	// ─────────── Section Header ───────────
	private func flushLocation(_ location: CLLocation?, _ placemark: CLPlacemark?) {
		let cbs = locationCompletions
		locationCompletions.removeAll()
		for cb in cbs { cb(location, placemark) }
	}
}

// ─────────── Geohash ───────────
private enum Geohash {
	private static let base32: [Character] = Array("0123456789bcdefghjkmnpqrstuvwxyz")
	
	static func encode(latitude: Double, longitude: Double, precision: Int = 9) -> String {
		let target = max(1, precision)
		var latMin = -90.0
		var latMax =  90.0
		var lonMin = -180.0
		var lonMax =  180.0
		
		var isEven = true
		var bit = 0
		var ch = 0
		
		var out = ""
		out.reserveCapacity(target)
		
		while out.count < target {
			if isEven {
				let mid = (lonMin + lonMax) / 2
				if longitude >= mid {
					ch = (ch << 1) | 1
					lonMin = mid
				} else {
					ch = (ch << 1)
					lonMax = mid
				}
			} else {
				let mid = (latMin + latMax) / 2
				if latitude >= mid {
					ch = (ch << 1) | 1
					latMin = mid
				} else {
					ch = (ch << 1)
					latMax = mid
				}
			}
			
			isEven.toggle()
			bit += 1
			
			if bit == 5 {
				out.append(base32[ch])
				bit = 0
				ch = 0
			}
		}
		
		return out
	}
}
