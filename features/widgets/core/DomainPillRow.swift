import SwiftUI
import FirebaseAnalytics
import FirebaseFirestore

struct DomainPillRow: View {
	@EnvironmentObject private var homeViewModel: HomeViewModel
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	
	@State private var domains: [Domain] = []
	@State private var cachedDisplayDomains: [Domain] = []
	
	// ─────────── Section Header ───────────
	private var selectedDomainId: String {
		homeViewModel.selectedDomain?.id ?? ""
	}
	
	private var isInBookmarksMode: Bool {
		if homeViewModel.overrideDomains?.first?.id == SpecialDomainID.bookmarks { return true }
		if homeViewModel.selectedDomain?.id == SpecialDomainID.bookmarks { return true }
		return false
	}
	
	// ─────────── Section Header ───────────
	private var visibleDomains: [Domain] {
		let source = !homeViewModel.domains.isEmpty ? homeViewModel.domains : domains
		return source.filter { $0.display }
	}
	
	// ─────────── Section Header ───────────
	private var pillCandidateDomains: [Domain] {
		visibleDomains.filter { $0.id.lowercased() != "home" }
	}
	
	// ─────────── Section Header ───────────
	private var userSelectedDomains: [Domain] {
		let prefs = servicesLocator.userService.user?.domainPreferences ?? [:]
		guard !prefs.isEmpty else { return [] }
		
		let selectedIds = Set(prefs.keys)
		let filtered = pillCandidateDomains.filter { selectedIds.contains($0.id) }
		return filtered.sorted {
			$0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
		}
	}
	
	// ─────────── Section Header ───────────
	private var preferencesSignature: String {
		let prefs = servicesLocator.userService.user?.domainPreferences ?? [:]
		return Array(prefs.keys).sorted().joined(separator: "|")
	}
	
	// ─────────── Section Header ───────────
	private var visibleDomainsSignature: String {
		pillCandidateDomains.map { $0.id }.sorted().joined(separator: "|")
	}
	
	var body: some View {
		Group {
			if #available(iOS 17.0, *) {
				ScrollView(.horizontal, showsIndicators: false) {
					content
				}
			} else {
				ScrollView(.horizontal, showsIndicators: false) {
					content
				}
			}
		}
		.onAppear {
			loadDomainsIfNeeded()
			rebuildDisplayDomainsIfPossible()
		}
		.onChange(of: preferencesSignature) { _ in
			rebuildDisplayDomainsIfPossible()
		}
		.onChange(of: visibleDomainsSignature) { _ in
			rebuildDisplayDomainsIfPossible()
		}
	}
	
	// ─────────── Section Header ───────────
	private var content: some View {
		HStack(spacing: 10) {
			
			// ─────────── Liked pill (only visible while in bookmarks mode) ───────────
			if isInBookmarksMode {
				DomainPill(
					title: "Liked",
					isSelected: true
				) {
					UIImpactFeedbackGenerator(style: .light).impactOccurred()
					
					Analytics.logEvent("home_liked_pill_tap", parameters: [
						"screen": "home" as NSString,
						"trigger": "tap" as NSString,
						"domain_id": SpecialDomainID.bookmarks as NSString,
						"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
					])
					
					if let selected = homeViewModel.selectedDomain,
					   selected.id == SpecialDomainID.bookmarks {
						homeViewModel.fetchGlanceCards(for: selected, isLoadingMore: false)
					} else {
						homeViewModel.showBookmarks()
					}
				}
			}
			
			// ─────────── For You ───────────
			DomainPill(
				title: "For You",
				isSelected: selectedDomainId.lowercased() == "home" && !isInBookmarksMode
			) {
				UIImpactFeedbackGenerator(style: .light).impactOccurred()
				
				Analytics.logEvent("for_you_pill_tap", parameters: [
					"screen": "home" as NSString,
					"trigger": "tap" as NSString,
					"domain_id": "home" as NSString,
					"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
				])
				
				let home = homeViewModel.domains.first(where: { $0.id.lowercased() == "home" })
				?? Domain(id: "home", name: "Home", display: true, categoryLabel: "Personalized feed", categories: [], imageUrl: nil)
				
				withAnimation(.easeInOut(duration: 0.2)) {
					if isInBookmarksMode {
						homeViewModel.hideBookmarks()
					} else {
						homeViewModel.overrideDomains = nil
						homeViewModel.selectedDomain = home
						if let idx = homeViewModel.domains.firstIndex(where: { $0.id.lowercased() == "home" }) {
							homeViewModel.lastViewedPageIndex = idx
						} else {
							homeViewModel.lastViewedPageIndex = 0
						}
					}
				}
			}
			
			// ─────────── Domain pills (selected + fill to 3) ───────────
			ForEach(cachedDisplayDomains, id: \.id) { domain in
				DomainPill(
					title: domain.name,
					isSelected: (!isInBookmarksMode && selectedDomainId == domain.id)
				) {
					UIImpactFeedbackGenerator(style: .light).impactOccurred()
					
					Analytics.logEvent("domain_pill_tap", parameters: [
						"screen": "home" as NSString,
						"trigger": "tap" as NSString,
						"domain_id": domain.id as NSString,
						"domain_name": domain.name as NSString,
						"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
					])
					
					withAnimation(.easeInOut(duration: 0.2)) {
						if isInBookmarksMode {
							homeViewModel.hideBookmarks()
						}
						homeViewModel.overrideDomains = [domain]
						homeViewModel.selectedDomain = domain
						homeViewModel.lastViewedPageIndex = 0
					}
				}
			}
		}
		.padding(.vertical, 2)
		.padding(.horizontal, 2)
	}
	
	// ─────────── Section Header ───────────
	private func rebuildDisplayDomainsIfPossible() {
		let sorted = pillCandidateDomains.sorted {
			$0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
		}
		
		let selected = userSelectedDomains
		
		if selected.count >= 5 {
			cachedDisplayDomains = selected
			return
		}
		
		let selectedSet = Set(selected.map { $0.id })
		let extrasNeeded = max(0, 5 - selected.count)
		
		if extrasNeeded == 0 {
			cachedDisplayDomains = selected
			return
		}
		
		let candidates = sorted.filter { !selectedSet.contains($0.id) }
		let extras = Array(candidates.shuffled().prefix(extrasNeeded))
		cachedDisplayDomains = selected + extras
	}
	
	// ─────────── Section Header ───────────
	private func loadDomainsIfNeeded() {
		if !homeViewModel.domains.isEmpty { return }
		guard domains.isEmpty else { return }
		
		Firestore.firestore().collection("domains").getDocuments { snapshot, error in
			guard error == nil, let docs = snapshot?.documents else { return }
			
			let loaded: [Domain] = docs.compactMap { doc in
				let data = doc.data()
				guard let name = data["name"] as? String else { return nil }
				let display       = data["display"] as? Bool ?? true
				let categoryLabel = data["categoryLabel"] as? String ?? ""
				let imageUrl      = data["imageUrl"] as? String
				
				let rawCategories = data["categories"] as? [[String: Any]] ?? []
				let categories: [DomainCategory] = rawCategories.compactMap { cat in
					guard
						let id   = cat["id"] as? String,
						let name = cat["name"] as? String
					else {
						return nil
					}
					return DomainCategory(id: id, name: name)
				}
				
				return Domain(
					id: doc.documentID,
					name: name,
					display: display,
					categoryLabel: categoryLabel,
					categories: categories,
					imageUrl: imageUrl
				)
			}
			
			let sorted = loaded.sorted { (Int($0.id) ?? 0) < (Int($1.id) ?? 0) }
			DispatchQueue.main.async {
				self.domains = sorted
				self.rebuildDisplayDomainsIfPossible()
			}
		}
	}
}
