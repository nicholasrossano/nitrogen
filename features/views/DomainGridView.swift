// DomainGridView.swift

import SwiftUI
import SDWebImageSwiftUI
import FirebaseAnalytics
import Combine
import FirebaseAuth
import FirebaseFirestore
import UIKit

struct DomainGridView: View {
	@StateObject private var viewModel: DomainGridViewModel
	@EnvironmentObject private var homeViewModel: HomeViewModel
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	@Environment(\.dismiss) private var modalDismiss
	@ObservedObject private var onboarding = OnboardingManager.shared
	
	private let overlayBinding: Binding<Bool>?
	private let onProfileToggle: () -> Void
	
	private let haptic = UIImpactFeedbackGenerator(style: .light)
	private let navigationHaptic = UIImpactFeedbackGenerator(style: .medium)
	@State private var showDomainSelection = false
	
	private let topChromeHeight: CGFloat = 44
	private let seenWindowDays = 28
	
	private let onboardingScrollTopId = "domain_grid_scroll_top"
	@State private var didScrollToOnboardingTop = false
	
	@State private var domainPreferencesLive: [String: [String]] = [:]
	@State private var domainPreferencesOrderingBaseline: [String: [String]] = [:]
	
	@State private var recentReadCardIds: Set<String> = []
	@State private var readSetVersion: Int = 0
	
	@State private var backdropDomainSnapshot: Domain? = nil
	@State private var backdropHomeAssetSnapshot: String? = nil
	
	init(overlayBinding: Binding<Bool>, onProfileToggle: @escaping () -> Void = {}) {
		_viewModel = StateObject(wrappedValue: DomainGridViewModel())
		self.overlayBinding = overlayBinding
		self.onProfileToggle = onProfileToggle
	}
	
	init(viewModel: DomainGridViewModel? = nil, onProfileToggle: @escaping () -> Void = {}) {
		_viewModel = StateObject(wrappedValue: viewModel ?? DomainGridViewModel())
		self.overlayBinding = nil
		self.onProfileToggle = onProfileToggle
	}
	
	var body: some View {
		GeometryReader { geo in
			let safeTop = geo.safeAreaInsets.top
			let safeBottom = geo.safeAreaInsets.bottom
			let w = geo.size.width
			let bPad = w * 0.05
			
			ZStack(alignment: .top) {
				backgroundView(size: geo.size)
					.ignoresSafeArea()
				
				if viewModel.isLoading && resolvedDomainsForShelves().isEmpty {
					VStack { Spacer() }
				} else {
					let topInset = topChromeContentInset(safeTop: safeTop, width: w)
					let bottomInset = safeBottom + bPad + topChromeHeight + 24
					
					shelvesContent(
						topContentInset: topInset,
						bottomContentInset: bottomInset
					)
					.transition(.opacity)
					.animation(.easeInOut(duration: 0.25), value: overlayBinding?.wrappedValue ?? true)
				}
				
				VStack(spacing: 0) {
					Spacer(minLength: 0)
					bottomChrome(safeBottom: safeBottom, width: w)
				}
				.zIndex(10)
			}
			.frame(width: geo.size.width, height: geo.size.height)
		}
		.onAppear {
			if backdropDomainSnapshot == nil {
				backdropDomainSnapshot =
				homeViewModel.selectedDomain ??
				homeViewModel.activeDomains.first ??
				Domain(
					id: "home",
					name: "Home",
					display: true,
					categoryLabel: "Personalized feed",
					categories: [],
					imageUrl: nil
				)
			}
			
			if backdropHomeAssetSnapshot == nil {
				backdropHomeAssetSnapshot = HomeImageSelector.selected
			}
			
			let currentPrefs = servicesLocator.userService.user?.domainPreferences ?? [:]
			domainPreferencesLive = currentPrefs
			domainPreferencesOrderingBaseline = currentPrefs
			
			refreshRecentReadSet(trigger: "domain_grid_open")
			
			Analytics.logEvent("domain_grid_open", parameters: [
				"screen": "domain_grid" as NSString,
				"topic_id": (homeViewModel.selectedDomain?.id ?? "") as NSString,
				"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
			])
		}
		.onReceive(servicesLocator.userService.$user) { user in
			domainPreferencesLive = user?.domainPreferences ?? [:]
		}
		.transition(.opacity)
		.animation(.easeInOut(duration: 0.45),
				   value: overlayBinding?.wrappedValue ?? false)
		.fullScreenCover(isPresented: $showDomainSelection) {
			DomainSelectionView {
				showDomainSelection = false
			}
			.environmentObject(servicesLocator)
			.environmentObject(homeViewModel)
		}
	}
	
	// ─────────── Onboarding helpers ───────────
	private func currentOnboardingStepId() -> String? {
		guard let flow = onboarding.currentFlow else { return nil }
		guard let steps = onboarding.flows[flow], onboarding.stepIndex < steps.count else { return nil }
		return steps[onboarding.stepIndex].id
	}
	
	private func wantsDomainGridOnboardingStep() -> Bool {
		guard onboarding.currentFlow == .home else { return false }
		guard let stepId = currentOnboardingStepId() else { return false }
		return stepId.hasPrefix("domain_grid_")
	}
	
	// ─────────── Recent reads (for shelf filtering) ───────────
	private func refreshRecentReadSet(trigger: String) {
		guard let uid = Auth.auth().currentUser?.uid else {
			DispatchQueue.main.async {
				self.recentReadCardIds = []
				self.readSetVersion += 1
			}
			return
		}
		
		let cutoff = Calendar.current.date(byAdding: .day, value: -seenWindowDays, to: Date()) ?? Date()
		let ts = Timestamp(date: cutoff)
		
		Analytics.logEvent("domain_grid_read_set_fetch_start", parameters: [
			"screen": "domain_grid" as NSString,
			"trigger": trigger as NSString,
			"topic_id": (homeViewModel.selectedDomain?.id ?? "") as NSString,
			"card_id": (homeViewModel.currentCard?.id ?? "") as NSString,
			"window_days": NSNumber(value: seenWindowDays)
		])
		
		Firestore.firestore()
			.collection("users")
			.document(uid)
			.collection("cardReads")
			.whereField("readAt", isGreaterThanOrEqualTo: ts)
			.getDocuments { snap, err in
				let ids = Set(snap?.documents.map { $0.documentID } ?? [])
				let ok = NSNumber(value: err == nil)
				let count = NSNumber(value: ids.count)
				
				DispatchQueue.main.async {
					self.recentReadCardIds = ids
					self.readSetVersion += 1
					
					Analytics.logEvent("domain_grid_read_set_fetch_complete", parameters: [
						"screen": "domain_grid" as NSString,
						"trigger": trigger as NSString,
						"topic_id": (homeViewModel.selectedDomain?.id ?? "") as NSString,
						"card_id": (homeViewModel.currentCard?.id ?? "") as NSString,
						"ok": ok,
						"read_ids_count": count,
						"error": (err?.localizedDescription ?? "") as NSString
					])
				}
			}
	}
	
	// ─────────── Bottom Chrome ───────────
	private var navigationCapsuleBinding: Binding<Bool> {
		if let binding = overlayBinding {
			return Binding(
				get: { binding.wrappedValue },
				set: { newValue in
					if newValue == false {
						dismiss(trigger: "cards_button")
					} else {
						binding.wrappedValue = true
					}
				}
			)
		}
		
		return Binding(
			get: { true },
			set: { newValue in
				if newValue == false {
					dismiss(trigger: "cards_button")
				}
			}
		)
	}
	
	private func bottomChrome(safeBottom: CGFloat, width w: CGFloat) -> some View {
		let hPad = w * 0.047
		let bPad = w * 0.05
		
		return HStack(spacing: 8) {
			NavigationCapsule(
				showDomainGrid: navigationCapsuleBinding,
				onProfileToggle: onProfileToggle,
				height: topChromeHeight
			)
			.environmentObject(homeViewModel)
			
			Spacer(minLength: 0)
			
			customizeButton
		}
		.frame(maxWidth: .infinity)
		.padding(.horizontal, hPad)
		.padding(.bottom, safeBottom + bPad)
	}
	
	private func topChromeContentInset(safeTop: CGFloat, width w: CGFloat) -> CGFloat {
		let extraTopPadding = w * 0.2
		return safeTop + extraTopPadding
	}
	
	// ─────────── Shelves ───────────
	private func shelvesContent(topContentInset: CGFloat, bottomContentInset: CGFloat) -> some View {
		let domains = resolvedDomainsForShelves()
		
		func maybeScrollToTopForOnboarding(_ scrollProxy: ScrollViewProxy, trigger: String) {
			guard wantsDomainGridOnboardingStep() else {
				didScrollToOnboardingTop = false
				return
			}
			guard !didScrollToOnboardingTop else { return }
			didScrollToOnboardingTop = true
			
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
				withAnimation(.easeInOut(duration: 0.25)) {
					scrollProxy.scrollTo(onboardingScrollTopId, anchor: .top)
				}
			}
		}
		
		return ScrollViewReader { scrollProxy in
			ScrollView(showsIndicators: false) {
				VStack(alignment: .leading, spacing: 0) {
					Color.clear
						.frame(height: topContentInset)
						.id(onboardingScrollTopId)
					
					LazyVStack(alignment: .leading, spacing: 20) {
						ForEach(Array(domains.enumerated()), id: \.element.id) { idx, domain in
							DomainShelfRow(
								domain: domain,
								displayName: shelfDisplayName(for: domain),
								isHomeShelf: isHomeDomain(domain),
								isStarSelected: isPreferredDomainByPreferences(domain),
								showsStar: !isHomeDomain(domain),
								readCardIds: recentReadCardIds,
								readSetVersion: readSetVersion,
								tourTagShelf: idx == 0,
								tourTagStar: idx == 1,
								tourTagFirstTile: idx == 0,
								onArrowTap: {
									navigationHaptic.impactOccurred()
									
									Analytics.logEvent("domain_shelf_arrow_tap", parameters: [
										"screen": "domain_grid" as NSString,
										"trigger": "tap" as NSString,
										"domain_id": domain.id as NSString,
										"topic_id": domain.id as NSString,
										"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
									])
									
									openDomain(domain, trigger: "header_arrow", tappedCardId: nil)
								},
								onStarTap: {
									haptic.impactOccurred()
									toggleDomainPreference(domain, trigger: "star")
								},
								onCardTap: { tappedCard, position in
									haptic.impactOccurred()
									Analytics.logEvent("domain_shelf_card_tap", parameters: [
										"screen": "domain_grid" as NSString,
										"domain_id": domain.id as NSString,
										"topic_id": domain.id as NSString,
										"card_id": tappedCard.id as NSString,
										"position": NSNumber(value: position)
									])
									openDomain(domain, trigger: "shelf_card", tappedCardId: tappedCard.id)
								},
								onPlaceholderTap: {
									haptic.impactOccurred()
									Analytics.logEvent("domain_shelf_placeholder_tap", parameters: [
										"screen": "domain_grid" as NSString,
										"domain_id": domain.id as NSString,
										"topic_id": domain.id as NSString,
										"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
									])
									openDomain(domain, trigger: "shelf_placeholder", tappedCardId: nil)
								}
							)
							.environmentObject(homeViewModel)
							
							if idx < domains.count - 1 {
								Divider()
									.overlay(Color.primary.opacity(0.5))
									.padding(.top, 4)
							}
						}
					}
				}
				.padding(.horizontal, 24)
				.padding(.bottom, bottomContentInset)
			}
			.onAppear { maybeScrollToTopForOnboarding(scrollProxy, trigger: "appear") }
			.onChange(of: onboarding.stepIndex) { _ in maybeScrollToTopForOnboarding(scrollProxy, trigger: "step_change") }
			.onChange(of: onboarding.currentFlow) { _ in maybeScrollToTopForOnboarding(scrollProxy, trigger: "flow_change") }
		}
	}
	
	private struct DomainShelfRow: View {
		let domain: Domain
		let displayName: String
		let isHomeShelf: Bool
		let isStarSelected: Bool
		let showsStar: Bool
		let readCardIds: Set<String>
		let readSetVersion: Int
		let tourTagShelf: Bool
		let tourTagStar: Bool
		let tourTagFirstTile: Bool
		let onArrowTap: () -> Void
		let onStarTap: () -> Void
		let onCardTap: (Card, Int) -> Void
		let onPlaceholderTap: () -> Void
		
		@EnvironmentObject private var homeViewModel: HomeViewModel
		@Environment(\.colorScheme) private var scheme
		
		@State private var didTriggerShelfLoadMore = false
		
		private var previewCards: [Card] {
			let cards = homeViewModel.glanceCards[domain.name] ?? []
			if cards.isEmpty { return [] }
			let filtered = cards.filter { !readCardIds.contains($0.id) }
			return Array(filtered.prefix(8))
		}
		
		private var heroCard: Card? {
			guard isHomeShelf else { return nil }
			return previewCards.first
		}
		
		private var rowCards: [Card] {
			if isHomeShelf {
				return Array(previewCards.dropFirst())
			}
			return previewCards
		}
		
		private var tileWidth: CGFloat {
			min(UIScreen.main.bounds.width * 0.4, 300)
		}
		
		private var tileHeight: CGFloat {
			tileWidth * 0.7
		}
		
		private var headlineHeight: CGFloat {
			86
		}
		
		private var fadeHeight: CGFloat {
			0
		}
		
		private var itemHeight: CGFloat {
			tileHeight + headlineHeight
		}
		
		private var heroTileWidth: CGFloat {
			(tileWidth * 2) + 14
		}
		
		private var heroTileHeight: CGFloat {
			heroTileWidth * 0.7
		}
		
		private var heroItemHeight: CGFloat {
			heroTileHeight + headlineHeight
		}
		
		private var heroHeadlineFontSize: CGFloat {
			17
		}
		
		private var starColor: Color {
			if isStarSelected { return Color.accentSecondary }
			return Color.primary.opacity(scheme == .dark ? 0.55 : 0.45)
		}
		
		private func maybeLoadMoreIfShelfWentEmpty(trigger: String) {
			guard !didTriggerShelfLoadMore else { return }
			let existing = homeViewModel.glanceCards[domain.name] ?? []
			guard !existing.isEmpty else { return }
			guard previewCards.isEmpty else { return }
			guard homeViewModel.noMoreCardsAvailable[domain.name] != true else { return }
			
			didTriggerShelfLoadMore = true
			
			Analytics.logEvent("domain_shelf_load_more_due_to_reads", parameters: [
				"screen": "domain_grid" as NSString,
				"trigger": trigger as NSString,
				"domain_id": domain.id as NSString,
				"topic_id": domain.id as NSString,
				"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
			])
			
			homeViewModel.fetchGlanceCards(for: domain, isLoadingMore: true)
		}
		
		@ViewBuilder
		private func starButton() -> some View {
			if showsStar {
				let base = Button {
					onStarTap()
				} label: {
					Image(systemName: isStarSelected ? "star.fill" : "star")
						.font(.system(size: 18, weight: .semibold))
						.foregroundColor(starColor)
						.frame(width: 34, height: 34)
						.contentShape(Rectangle())
				}
					.buttonStyle(.plain)
					.accessibilityLabel(isStarSelected ? "Remove from favorites" : "Add to favorites")
				
				if tourTagStar {
					base.tourTag("domain_grid_top_star")
				} else {
					base
				}
			}
		}
		
		@ViewBuilder
		private func tileView(card: Card, idx: Int) -> some View {
			CardTile(
				card: card,
				fallbackHeadline: (card.headline ?? displayName),
				tileWidth: tileWidth,
				tileHeight: tileHeight,
				headlineHeight: headlineHeight,
				fadeHeight: fadeHeight
			)
			.frame(width: tileWidth, height: itemHeight)
			.contentShape(Rectangle())
		}
		
		@ViewBuilder
		private func heroTileView(card: Card) -> some View {
			let base = CardTile(
				card: card,
				fallbackHeadline: (card.headline ?? displayName),
				tileWidth: heroTileWidth,
				tileHeight: heroTileHeight,
				headlineHeight: headlineHeight,
				fadeHeight: fadeHeight,
				headlineFontSize: heroHeadlineFontSize
			)
				.frame(width: heroTileWidth, height: heroItemHeight)
				.contentShape(Rectangle())
			
			if tourTagFirstTile {
				base.tourTag("domain_grid_card_tile")
			} else {
				base
			}
		}
		
		private var boundedShelfHighlightWidth: CGFloat {
			let screenW = UIScreen.main.bounds.width
			let twoTiles = heroTileWidth
			let maxOnScreen = max(0, screenW - (24 * 2))
			return min(maxOnScreen, twoTiles + 18)
		}
		
		private var boundedShelfHighlightHeight: CGFloat {
			let headerHitHeight: CGFloat = 44
			let gapBelowHeader: CGFloat = 12
			let contentHeight = (isHomeShelf && heroCard != nil) ? heroItemHeight : itemHeight
			return headerHitHeight + gapBelowHeader + contentHeight
		}
		
		var body: some View {
			let shelfHorizontalPadding: CGFloat = 24
			let screenW = UIScreen.main.bounds.width
			
			VStack(alignment: .leading, spacing: 12) {
				HStack(spacing: 10) {
					Text(displayName)
						.font(.custom("Didot-Bold", size: 20))
						.foregroundColor(.primary)
						.lineLimit(1)
					
					Button {
						onArrowTap()
					} label: {
						Image(systemName: "arrow.forward.circle.fill")
							.font(.system(size: 18, weight: .semibold))
							.foregroundColor(Color.accentSecondary)
							.frame(width: 34, height: 34)
							.contentShape(Rectangle())
					}
					.buttonStyle(.plain)
					.accessibilityLabel("Open \(displayName)")
					
					Spacer(minLength: 0)
					
					starButton()
				}
				
				if isHomeShelf, let heroCard {
					Button {
						onCardTap(heroCard, 0)
					} label: {
						heroTileView(card: heroCard)
					}
					.buttonStyle(PressScaleStyle())
					.padding(.leading, shelfHorizontalPadding)
					.padding(.vertical, 2)
					.frame(width: screenW, alignment: .leading)
					.offset(x: -shelfHorizontalPadding)
				}
				
				if previewCards.isEmpty || !rowCards.isEmpty {
					ScrollView(.horizontal, showsIndicators: false) {
						LazyHStack(spacing: 14) {
							if previewCards.isEmpty {
								ForEach(0..<6, id: \.self) { _ in
									Button {
										onPlaceholderTap()
									} label: {
										RoundedRectangle(cornerRadius: 20)
											.fill(Color.primary.opacity(0.08))
											.frame(width: tileWidth, height: itemHeight)
											.contentShape(Rectangle())
									}
									.buttonStyle(PressScaleStyle())
								}
							} else {
								ForEach(Array(rowCards.enumerated()), id: \.element.id) { idx, card in
									let position = isHomeShelf ? (idx + 1) : idx
									
									Button {
										onCardTap(card, position)
									} label: {
										tileView(card: card, idx: position)
									}
									.buttonStyle(PressScaleStyle())
								}
							}
						}
						.padding(.leading, shelfHorizontalPadding)
						.padding(.vertical, 2)
					}
					.frame(width: screenW, alignment: .leading)
					.offset(x: -shelfHorizontalPadding)
				}
			}
			.overlay(alignment: .topLeading) {
				if tourTagShelf {
					Color.clear
						.frame(width: boundedShelfHighlightWidth, height: boundedShelfHighlightHeight)
						.allowsHitTesting(false)
						.tourTag("domain_grid_top_shelf")
				}
			}
			.onAppear {
				if homeViewModel.glanceCards[domain.name] == nil {
					homeViewModel.fetchGlanceCards(for: domain, isLoadingMore: false, domainPrefsOverride: nil)
				}
				maybeLoadMoreIfShelfWentEmpty(trigger: "row_appear")
			}
			.onChange(of: readSetVersion) { _ in
				maybeLoadMoreIfShelfWentEmpty(trigger: "read_set_update")
			}
		}
	}
	
	// ─────────── Domain ordering + naming ───────────
	private var preferredDomainIdSetLowercasedLive: Set<String> {
		Set(domainPreferencesLive.keys.map { $0.lowercased() })
	}
	
	private var preferredDomainIdSetLowercasedOrderingBaseline: Set<String> {
		Set(domainPreferencesOrderingBaseline.keys.map { $0.lowercased() })
	}
	
	private func isPreferredDomainByPreferences(_ domain: Domain) -> Bool {
		preferredDomainIdSetLowercasedLive.contains(domain.id.lowercased())
	}
	
	private func isPreferredDomainForOrdering(_ domain: Domain) -> Bool {
		preferredDomainIdSetLowercasedOrderingBaseline.contains(domain.id.lowercased())
	}
	
	private func toggleDomainPreference(_ domain: Domain, trigger: String) {
		guard !isHomeDomain(domain) else { return }
		
		var updated = domainPreferencesLive
		let existingKey = updated.keys.first(where: { $0.lowercased() == domain.id.lowercased() })
		
		let willSelect: Bool
		if let existingKey {
			updated.removeValue(forKey: existingKey)
			willSelect = false
		} else {
			updated[domain.id] = []
			willSelect = true
		}
		
		domainPreferencesLive = updated
		
		Analytics.logEvent("domain_preference_star_toggle", parameters: [
			"screen": "domain_grid" as NSString,
			"trigger": trigger as NSString,
			"domain_id": domain.id as NSString,
			"topic_id": domain.id as NSString,
			"card_id": (homeViewModel.currentCard?.id ?? "") as NSString,
			"is_selected": NSNumber(value: willSelect)
		])
		
		servicesLocator.userService.updateDomainPreferences(updated) { ok, errorMessage in
			Analytics.logEvent("domain_preference_star_save_result", parameters: [
				"screen": "domain_grid" as NSString,
				"trigger": trigger as NSString,
				"domain_id": domain.id as NSString,
				"topic_id": domain.id as NSString,
				"card_id": (homeViewModel.currentCard?.id ?? "") as NSString,
				"ok": NSNumber(value: ok),
				"error": (errorMessage ?? "") as NSString
			])
		}
		
		RankingService.shared.updateDomainPreferences(updated)
		homeViewModel.reloadHomeAfterDomainPreferencesChange(updated)
	}
	
	private func resolvedDomainsForShelves() -> [Domain] {
		let sourceDomains: [Domain] = {
			if !homeViewModel.domains.isEmpty { return homeViewModel.domains }
			return viewModel.domains
		}()
		
		let displayed = sourceDomains.filter { $0.display }
		
		let homeDomain: Domain = {
			if let existing = displayed.first(where: { isHomeDomain($0) }) {
				return existing
			}
			return Domain(
				id: "home",
				name: "Home",
				display: true,
				categoryLabel: "Personalized feed",
				categories: [],
				imageUrl: nil
			)
		}()
		
		let others = displayed.filter { !isHomeDomain($0) }
		
		let sortedOthers = others.sorted { a, b in
			let aSelected = isPreferredDomainForOrdering(a)
			let bSelected = isPreferredDomainForOrdering(b)
			if aSelected != bSelected { return aSelected }
			return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
		}
		
		return [homeDomain] + sortedOthers
	}
	
	private func isHomeDomain(_ domain: Domain) -> Bool {
		if domain.id.lowercased() == "home" { return true }
		let name = domain.name.lowercased()
		return name == "home" || name == "for you"
	}
	
	private func shelfDisplayName(for domain: Domain) -> String {
		if isHomeDomain(domain) { return "For You" }
		return domain.name
	}
	
	// ─────────── Open domain ───────────
	private func openDomain(_ chosen: Domain, trigger: String, tappedCardId: String?) {
		let cardIdValue = (tappedCardId ?? homeViewModel.currentCard?.id ?? "")
		
		Analytics.logEvent("domain_tile_tap", parameters: [
			"screen": "domain_grid" as NSString,
			"trigger": trigger as NSString,
			"domain_id": chosen.id as NSString,
			"card_id": cardIdValue as NSString
		])
		
		if tappedCardId == nil || tappedCardId?.isEmpty == true {
			homeViewModel.shelfPreviewFocusRequest = nil
		}
		
		if isHomeDomain(chosen) {
			let home = homeViewModel.domains.first(where: { isHomeDomain($0) })
			?? Domain(id: "home", name: "Home", display: true, categoryLabel: "Personalized feed", categories: [], imageUrl: nil)
			
			withAnimation(.easeInOut(duration: 0.2)) {
				homeViewModel.overrideDomains = nil
				homeViewModel.selectedDomain = home
				if let idx = homeViewModel.domains.firstIndex(where: { isHomeDomain($0) }) {
					homeViewModel.lastViewedPageIndex = idx
				} else {
					homeViewModel.lastViewedPageIndex = 0
				}
			}
			
			if let tappedCardId, !tappedCardId.isEmpty {
				homeViewModel.focusCardForShelfPreview(domain: home, cardID: tappedCardId)
			}
			
			dismiss(trigger: trigger)
			return
		}
		
		withAnimation(.easeInOut(duration: 0.2)) {
			homeViewModel.overrideDomains = [chosen]
			homeViewModel.selectedDomain = chosen
			homeViewModel.lastViewedPageIndex = 0
		}
		
		if let tappedCardId, !tappedCardId.isEmpty {
			homeViewModel.focusCardForShelfPreview(domain: chosen, cardID: tappedCardId)
		}
		
		dismiss(trigger: trigger)
	}
	
	// ─────────── Controls ───────────
	private var customizeButton: some View {
		Button {
			haptic.impactOccurred()
			
			Analytics.logEvent("domain_customize_tap", parameters: [
				"screen": "domain_grid" as NSString,
				"trigger": "tap" as NSString,
				"domain_id": (homeViewModel.selectedDomain?.id ?? "") as NSString,
				"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
			])
			
			showDomainSelection = true
		} label: {
			HStack(spacing: 6) {
				Image(systemName: "pencil")
					.font(.system(size: 14, weight: .semibold))
				Text("Customize")
					.font(.custom("Avenir", size: 14))
			}
			.foregroundColor(.white)
			.padding(.horizontal, 12)
			.frame(height: topChromeHeight)
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
			.compositingGroup()
		}
		.buttonStyle(PressScaleStyle())
		.accessibilityLabel("Customize domains")
		.tourTag("domain_grid_customize_button")
	}
	
	// ─────────── Background ───────────
	private func resolvedBackdropDomain() -> Domain {
		backdropDomainSnapshot ??
		homeViewModel.selectedDomain ??
		homeViewModel.activeDomains.first ??
		Domain(
			id: "home",
			name: "Home",
			display: true,
			categoryLabel: "Personalized feed",
			categories: [],
			imageUrl: nil
		)
	}
	
	private func remoteURL(from urlString: String?) -> URL? {
		guard let raw = urlString?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
		guard raw.lowercased().hasPrefix("http"), let url = URL(string: raw) else { return nil }
		return url
	}
	
	private func localAssetName(from urlString: String?) -> String? {
		guard let raw = urlString?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
		guard !raw.lowercased().hasPrefix("http") else { return nil }
		return UIImage(named: raw) != nil ? raw : nil
	}
	
	@ViewBuilder
	private func backdropImageView(size: CGSize) -> some View {
		let domain = resolvedBackdropDomain()
		let w = size.width
		let h = size.height
		
		if domain.id == SpecialDomainID.bookmarks {
			Image("Bookmarks")
				.resizable()
				.aspectRatio(contentMode: .fill)
				.frame(width: w, height: h)
				.clipped()
		} else if isHomeDomain(domain) {
			if let asset = (backdropHomeAssetSnapshot ?? HomeImageSelector.selected) {
				Image(asset)
					.resizable()
					.aspectRatio(contentMode: .fill)
					.frame(width: w, height: h)
					.clipped()
			} else if let url = remoteURL(from: domain.imageUrl) {
				WebImage(url: url)
					.resizable()
					.indicator(.activity)
					.aspectRatio(contentMode: .fill)
					.frame(width: w, height: h)
					.clipped()
			} else if let assetName = localAssetName(from: domain.imageUrl) {
				Image(assetName)
					.resizable()
					.aspectRatio(contentMode: .fill)
					.frame(width: w, height: h)
					.clipped()
			} else {
				Color.gray.frame(width: w, height: h)
			}
		} else if let url = remoteURL(from: domain.imageUrl) {
			WebImage(url: url)
				.resizable()
				.indicator(.activity)
				.aspectRatio(contentMode: .fill)
				.frame(width: w, height: h)
				.clipped()
		} else if let assetName = localAssetName(from: domain.imageUrl) {
			Image(assetName)
				.resizable()
				.aspectRatio(contentMode: .fill)
				.frame(width: w, height: h)
				.clipped()
		} else {
			Color.gray.frame(width: w, height: h)
		}
	}
	
	@ViewBuilder
	private func backgroundView(size: CGSize) -> some View {
		ZStack {
			backdropImageView(size: size)
			
			LinearGradient(
				gradient: Gradient(colors: [Color.black.opacity(0.5), Color.black.opacity(0.2)]),
				startPoint: .top,
				endPoint: .bottom
			)
			
			BlurView(style: .systemUltraThinMaterial, intensity: 0)
				.ignoresSafeArea()
				.allowsHitTesting(false)
		}
		.contentShape(Rectangle())
		.onTapGesture { dismiss(trigger: "tap_backdrop") }
		.transition(.opacity)
		.animation(.easeInOut(duration: 0.25), value: overlayBinding?.wrappedValue ?? true)
	}
	
	// ─────────── Dismiss ───────────
	private func dismiss(trigger: String) {
		DispatchQueue.main.async {
			Analytics.logEvent("domain_grid_close", parameters: [
				"screen": "domain_grid" as NSString,
				"trigger": trigger as NSString,
				"domain_id": (homeViewModel.selectedDomain?.id ?? "") as NSString,
				"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
			])
			
			if let binding = overlayBinding {
				withAnimation(.easeInOut(duration: 0.15)) { binding.wrappedValue = false }
			} else {
				modalDismiss()
			}
		}
	}
}
