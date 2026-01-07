import SwiftUI
import Combine
import FirebaseFirestore
import FirebaseAuth
import AVFoundation
import SDWebImage
import FirebaseAnalytics

enum SpecialDomainID {
	static let bookmarks = "bookmarks"
}

struct ShelfPreviewFocusRequest: Equatable {
	let domainName: String
	let cardID: String
	let requestID: String
}

final class HomeViewModel: ObservableObject {
	@Published var domains: [Domain] = []
	@Published var overrideDomains: [Domain]? = nil
	var activeDomains: [Domain] { overrideDomains ?? domains }
	
	@Published var selectedDomain: Domain? {
		didSet {
			guard let domain = selectedDomain else { return }
			if glanceCards[domain.name] == nil {
				fetchGlanceCards(for: domain)
			}
		}
	}
	
	@Published var isLoading = false
	@Published var glanceCards: [String: [Card]] = [:]
	@Published var noMoreCardsAvailable: [String: Bool] = [:]
	@Published var bookmarkStatuses: [String: Bool] = [:]
	@Published var lastViewedPageIndex = 0
	@Published var isCardExpanded: Bool = true
	@Published var currentCard: Card?
	@Published var shelfPreviewFocusRequest: ShelfPreviewFocusRequest? = nil
	
	private let db = Firestore.firestore()
	private var cancellables = Set<AnyCancellable>()
	private let servicesLocator = AppServicesLocator.shared
	
	private var readCardIds: [String: Set<String>] = [:]
	private var forcedDeepLinkedCard: (domainName: String, cardID: String)?
	private var pendingDeepLink: (domainID: String, cardID: String)?
	private var domainsLoaded = false
	private var initialDomainSelected = false
	
	private var lastDocumentPerDomain: [String: DocumentSnapshot] = [:]
	private var isLoadingMoreDomains: Set<String> = []
	private var lastFetchStartPerDomain: [String: CFAbsoluteTime] = [:]
	private var avgFetchDurationPerDomain: [String: Double] = [:]
	private var lastCardChangeTimePerDomain: [String: CFAbsoluteTime] = [:]
	private var avgSwipeIntervalPerDomain: [String: Double] = [:]
	
	private var seenCardIdsGlobal: Set<String> = []
	private var seenSetLoaded = false
	private var seenSetLoading = false
	private var onSeenLoaded: [() -> Void] = []
	private var seenListener: ListenerRegistration?
	private let seenWindowDays = 28
	
	private var fetchedRecsForHome = false
	private let stageRecommendationsURL = URL(string: "https://us-central1-ponder-f84ce.cloudfunctions.net/stage_recommendations")!
	
	// ─────────── Recommendations hydration state ───────────
	private var stagedRecIds: [String] = []
	private var recHydrationCursor: Int = 0
	private var isHydratingRecs: Bool = false
	private let recInitialPageSize = 30
	private let recLoadMorePageSize = 25
	private var neighborSimByCardId: [String: Double] = [:]
	
	// ─────────── Per-domain fetch cancellation & staleness guards ───────────
	private var domainFetchTokens: [String: UUID] = [:]
	private var domainFetchCancellables: [String: [AnyCancellable]] = [:]
	
	// ─────────── Domain prefs change signature (driven by UserService.user) ───────────
	private var lastPrefsSignature: String? = nil
	private var pendingHomeDomainPrefs: [String: [String]]? = nil
	
	deinit { seenListener?.remove() }
	
	init() {
		servicesLocator.visibilityNotifier.mode = .expandedCard
		
		servicesLocator.visibilityNotifier.$mode
			.map { _ in true }
			.removeDuplicates()
			.assign(to: \.isCardExpanded, on: self)
			.store(in: &cancellables)
		
		servicesLocator.userService.$user
			.map { user in
				let keys = user?.domainPreferences.keys.sorted() ?? []
				return keys.joined(separator: ",")
			}
			.removeDuplicates()
			.debounce(
				for: DispatchQueue.SchedulerTimeType.Stride.milliseconds(450),
				scheduler: DispatchQueue.main
			)
			.sink { [weak self] signature in
				guard let self else { return }
				let previous = self.lastPrefsSignature
				self.lastPrefsSignature = signature
				guard previous != nil else { return }
				
				Analytics.logEvent("home_refetch_due_to_domain_prefs_change", parameters: [
					"screen": "home" as NSString
				])
				self.reloadHomeAfterDomainPreferencesChange()
			}
			.store(in: &cancellables)
	}
	
	// ─────────── Section Header ───────────
	private func isHomeDomain(_ domain: Domain) -> Bool {
		if domain.id.lowercased() == "home" { return true }
		let n = domain.name.lowercased()
		return n == "home" || n == "for you"
	}
	
	private func resolvedHomeDomain() -> Domain {
		domains.first(where: { isHomeDomain($0) }) ??
		Domain(
			id: "home",
			name: "Home",
			display: true,
			categoryLabel: "Personalized feed",
			categories: [],
			imageUrl: nil
		)
	}
	
	private func resolvedHomeName() -> String {
		resolvedHomeDomain().name
	}
	
	// ─────────── Section Header ───────────
	func prefetchRecommendationsEarly(limit: Int = 200) {
		guard !fetchedRecsForHome else { return }
		guard Auth.auth().currentUser?.uid != nil else { return }
		fetchedRecsForHome = true
		fetchStageRecommendationsAndMerge(limit: limit)
	}
	
	// ─────────── Section Header ───────────
	func fetchFavorites() {
		// favorites are deprecated; domainPreferences is the source of truth
	}
	
	// MARK: - Domains
	
	func fetchAllDomains() {
		guard overrideDomains == nil, !isLoading else { return }
		
		guard Auth.auth().currentUser != nil else {
			NotificationCenter.default.publisher(for: .userDidAuthenticate)
				.first()
				.receive(on: DispatchQueue.main)
				.sink { [weak self] _ in self?.fetchAllDomains() }
				.store(in: &cancellables)
			return
		}
		
		warmSeenSetIfNeeded()
		RankingService.shared.refreshProfile()
		
		isLoading = true
		Analytics.logEvent("home_domains_fetch_start", parameters: [
			"source": "fetchAllDomains" as NSString
		])
		
		db.collection("domains").getDocuments { [weak self] snapshot, error in
			DispatchQueue.main.async {
				guard let self else { return }
				
				if let error {
					self.isLoading = false
					Analytics.logEvent("home_domains_fetch_error", parameters: [
						"stage": "fetch" as NSString,
						"message": error.localizedDescription as NSString
					])
					return
				}
				
				let docs = snapshot?.documents ?? []
				var loaded: [Domain] = docs.compactMap { doc in
					let data = doc.data()
					guard let name = data["name"] as? String else { return nil }
					
					let display       = data["display"] as? Bool ?? true
					let categoryLabel = data["categoryLabel"] as? String ?? ""
					let imageUrl      = data["imageUrl"] as? String
					
					let rawCategories = data["categories"] as? [[String: Any]] ?? []
					let categories: [DomainCategory] = rawCategories.compactMap { cat in
						guard let id = cat["id"] as? String,
							  let name = cat["name"] as? String
						else { return nil }
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
				
				if !loaded.contains(where: { $0.id.lowercased() == "home" }) {
					loaded.insert(self.resolvedHomeDomain(), at: 0)
				}
				
				loaded.sort { a, b in
					if self.isHomeDomain(a) != self.isHomeDomain(b) { return self.isHomeDomain(a) }
					let ai = Int(a.id) ?? Int.max
					let bi = Int(b.id) ?? Int.max
					if ai != bi { return ai < bi }
					return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
				}
				
				self.domains = loaded
				self.isLoading = false
				self.domainsLoaded = true
				
				Analytics.logEvent("home_domains_fetch_complete", parameters: [
					"count": NSNumber(value: self.domains.count)
				])
				
				if !self.initialDomainSelected && self.selectedDomain == nil {
					self.selectedDomain = self.domains.first
					self.initialDomainSelected = true
				} else if let sel = self.selectedDomain, self.glanceCards[sel.name] == nil {
					self.fetchGlanceCards(for: sel)
				}
				
				if let pending = self.pendingDeepLink {
					self.handleDeepLink(domainID: pending.domainID, cardID: pending.cardID)
					self.pendingDeepLink = nil
				}
			}
		}
	}
	
	// MARK: - Bookmarks (Liked)
	
	func showBookmarks() {
		let bm = Domain(
			id: SpecialDomainID.bookmarks,
			name: "Liked",
			display: true,
			categoryLabel: "",
			categories: [],
			imageUrl: "Bookmarks"
		)
		overrideDomains = [bm]
		selectedDomain  = bm
		fetchGlanceCards(for: bm)
		
		Analytics.logEvent("home_bookmarks_open", parameters: [
			"screen": "home" as NSString
		])
	}
	
	func hideBookmarks() {
		overrideDomains = nil
		selectedDomain = domains.first(where: { isHomeDomain($0) }) ?? domains.first
		lastViewedPageIndex = 0
		
		Analytics.logEvent("home_bookmarks_close", parameters: [
			"screen": "home" as NSString
		])
	}
	
	func showLiked() { showBookmarks() }
	func hideLiked() { hideBookmarks() }
	
	// MARK: - Home rebuild
	
	func reloadHomeAfterDomainPreferencesChange(_ overridePrefs: [String: [String]]? = nil) {
		Analytics.logEvent("home_reload_after_domain_prefs_change", parameters: [
			"screen": "home" as NSString
		])
		
		let effectivePrefs: [String: [String]]?
		if let overridePrefs {
			effectivePrefs = overridePrefs.isEmpty ? nil : overridePrefs
		} else if let prefs = servicesLocator.userService.user?.domainPreferences {
			effectivePrefs = prefs.isEmpty ? nil : prefs
		} else {
			effectivePrefs = nil
		}
		
		if let prefs = effectivePrefs {
			RankingService.shared.updateDomainPreferences(prefs)
		}
		
		pendingHomeDomainPrefs = effectivePrefs
		
		let home = resolvedHomeDomain()
		let homeName = home.name
		
		cancelFetches(for: homeName)
		
		glanceCards[homeName] = nil
		noMoreCardsAvailable[homeName] = false
		lastDocumentPerDomain[homeName] = nil
		currentCard = nil
		stagedRecIds.removeAll()
		recHydrationCursor = 0
		fetchedRecsForHome = false
		
		fetchGlanceCards(for: home, isLoadingMore: false, domainPrefsOverride: effectivePrefs)
		selectedDomain = home
	}
	
	// MARK: - Fetch cards
	
	func fetchGlanceCards(
		for domain: Domain,
		isLoadingMore: Bool = false,
		domainPrefsOverride: [String: [String]]? = nil
	) {
		if !isLoadingMore { isLoading = true }
		guard servicesLocator.userService.getUserId() != nil else {
			if !isLoadingMore { isLoading = false }
			return
		}
		
		let name = domain.name
		
		cancelFetches(for: name)
		let fetchToken = UUID()
		domainFetchTokens[name] = fetchToken
		
		lastFetchStartPerDomain[name] = CFAbsoluteTimeGetCurrent()
		
		Analytics.logEvent("home_cards_fetch_start", parameters: [
			"domain_id": domain.id as NSString,
			"domain_name": domain.name as NSString,
			"is_load_more": NSNumber(value: isLoadingMore)
		])
		
		if domain.id == SpecialDomainID.bookmarks {
			let c = servicesLocator.bookmarksService.getBookmarkedCards()
				.receive(on: DispatchQueue.main)
				.sink { [weak self] completion in
					guard let self else { return }
					guard self.domainFetchTokens[name] == fetchToken else { return }
					if case .failure = completion {
						self.glanceCards[name] = []
					}
					if !isLoadingMore { self.isLoading = false }
					self.isLoadingMoreDomains.remove(name)
				} receiveValue: { [weak self] (items: [(cardId: String, dateAdded: Date)]) in
					guard let self else { return }
					guard self.domainFetchTokens[name] == fetchToken else { return }
					
					guard !items.isEmpty else {
						self.glanceCards[name] = []
						if !isLoadingMore { self.isLoading = false }
						self.isLoadingMoreDomains.remove(name)
						return
					}
					
					let sortedIds = items
						.sorted { $0.dateAdded > $1.dateAdded }
						.map { $0.cardId }
					
					var seen = Set<String>()
					let uniqueIds = sortedIds.filter { seen.insert($0).inserted }
					
					func finish(_ allCards: [Card], requestedIds: [String]) {
						let byId = Dictionary(uniqueKeysWithValues: allCards.map { ($0.id, $0) })
						let ordered = requestedIds.compactMap { byId[$0] }
						
						self.glanceCards[name] = ordered
						for c in ordered { self.bookmarkStatuses[c.id] = true }
						
						let missing = max(0, requestedIds.count - ordered.count)
						if missing > 0 {
							Analytics.logEvent("home_liked_hydration_gap", parameters: [
								"screen": "home" as NSString,
								"requested": NSNumber(value: requestedIds.count),
								"hydrated": NSNumber(value: ordered.count),
								"missing": NSNumber(value: missing)
							])
						}
						
						if !isLoadingMore { self.isLoading = false }
						self.isLoadingMoreDomains.remove(name)
					}
					
					self.fetchCardsByIdsAcrossCollections(uniqueIds) { baseCards in
						guard self.domainFetchTokens[name] == fetchToken else { return }
						
						let baseSet = Set(baseCards.map { $0.id })
						let missingIds = uniqueIds.filter { !baseSet.contains($0) }
						
						guard !missingIds.isEmpty else {
							DispatchQueue.main.async {
								finish(baseCards, requestedIds: uniqueIds)
							}
							return
						}
						
						Analytics.logEvent("home_liked_fallback_fetch_start", parameters: [
							"screen": "home" as NSString,
							"missing": NSNumber(value: missingIds.count)
						])
						
						let publishers: [AnyPublisher<Card?, Never>] = missingIds.map { id in
							self.servicesLocator.cardService.fetchCardById(id)
								.replaceError(with: nil)
								.eraseToAnyPublisher()
						}
						
						let fallback = Publishers.MergeMany(publishers)
							.collect()
							.receive(on: DispatchQueue.main)
							.sink { [weak self] maybeCards in
								guard let self else { return }
								guard self.domainFetchTokens[name] == fetchToken else { return }
								
								let extras = maybeCards.compactMap { $0 }
								var combined = baseCards
								var combinedSet = baseSet
								for c in extras where combinedSet.insert(c.id).inserted {
									combined.append(c)
								}
								
								let stillMissing = max(0, uniqueIds.count - combinedSet.count)
								Analytics.logEvent("home_liked_fallback_fetch_complete", parameters: [
									"screen": "home" as NSString,
									"missing_initial": NSNumber(value: missingIds.count),
									"fetched_extra": NSNumber(value: extras.count),
									"still_missing": NSNumber(value: stillMissing)
								])
								
								finish(combined, requestedIds: uniqueIds)
							}
						
						var arr2 = self.domainFetchCancellables[name] ?? []
						arr2.append(fallback)
						self.domainFetchCancellables[name] = arr2
					}
				}
			
			var arr = domainFetchCancellables[name] ?? []
			arr.append(c)
			domainFetchCancellables[name] = arr
			return
		}
		
		if isHomeDomain(domain) {
			let basePrefs = domainPrefsOverride
			?? pendingHomeDomainPrefs
			?? servicesLocator.userService.user?.domainPreferences
			?? [:]
			
			let effectivePrefs = basePrefs.isEmpty ? nil : basePrefs
			let selectedDomainIds: [String] = effectivePrefs.map { Array($0.keys) } ?? []
			
			let lastDoc = isLoadingMore ? lastDocumentPerDomain[name] : nil
			let pageSize = isLoadingMore ? 25 : 30
			
			let publisher: AnyPublisher<([Card], DocumentSnapshot?), Error>
			if selectedDomainIds.isEmpty {
				publisher = servicesLocator.cardService.fetchCardsForHomeFeed(
					limit: pageSize,
					lastDocument: lastDoc
				)
			} else {
				publisher = servicesLocator.cardService.fetchCardsForDomains(
					selectedDomainIds,
					limit: pageSize,
					lastDocument: lastDoc
				)
			}
			
			let c = publisher
				.receive(on: DispatchQueue.main)
				.sink { [weak self] comp in
					guard let self else { return }
					guard self.domainFetchTokens[name] == fetchToken else { return }
					if !isLoadingMore { self.isLoading = false }
					if case .failure(let err) = comp {
						self.isLoadingMoreDomains.remove(name)
						Analytics.logEvent("home_cards_fetch_error", parameters: [
							"domain_name": name as NSString,
							"message": err.localizedDescription as NSString
						])
					}
				} receiveValue: { [weak self] (cards: [Card], newLast: DocumentSnapshot?) in
					guard let self else { return }
					guard self.domainFetchTokens[name] == fetchToken else { return }
					
					self.isLoadingMoreDomains.remove(name)
					self.lastDocumentPerDomain[name] = newLast
					
					let working = self.filterHomeCardsByDomainPreferences(
						cards,
						preserveCardId: self.forcedDeepLinkedCard?.cardID,
						overridePrefs: effectivePrefs
					)
					
					let readSet = self.readCardIds[name] ?? []
					var filtered = working.filter { card in
						(self.forcedDeepLinkedCard?.cardID == card.id) || !readSet.contains(card.id)
					}
					
					if !isLoadingMore {
						filtered = RankingService.shared.rank(cards: filtered, topicName: name)
						self.mergeFetchedCards(filtered, for: domain)
					} else {
						if filtered.isEmpty {
							if cards.isEmpty || newLast == nil { self.noMoreCardsAvailable[name] = true }
						} else {
							var existing = self.glanceCards[name] ?? []
							for c in filtered where !existing.contains(where: { $0.id == c.id }) {
								existing.append(c)
							}
							self.glanceCards[name] = existing
						}
					}
					
					for c in filtered where self.bookmarkStatuses[c.id] == nil {
						self.servicesLocator.bookmarksService.isCardBookmarked(cardId: c.id) { b in
							DispatchQueue.main.async { self.bookmarkStatuses[c.id] = b }
						}
					}
					
					if !isLoadingMore && !self.fetchedRecsForHome {
						self.fetchedRecsForHome = true
						if self.seenSetLoaded {
							self.fetchStageRecommendationsAndMerge(limit: 200)
						} else {
							self.onSeenLoaded.append { [weak self] in
								self?.fetchStageRecommendationsAndMerge(limit: 200)
							}
							self.warmSeenSetIfNeeded()
						}
					}
				}
			
			var arr = domainFetchCancellables[name] ?? []
			arr.append(c)
			domainFetchCancellables[name] = arr
			return
		}
		
		let domainId = domain.id
		let lastDoc = isLoadingMore ? lastDocumentPerDomain[name] : nil
		let pageSize = isLoadingMore ? 25 : 30
		
		let c = servicesLocator.cardService.fetchCardsByDomain(
			domainId,
			limit: pageSize,
			lastDocument: lastDoc
		)
			.receive(on: DispatchQueue.main)
			.sink { [weak self] comp in
				guard let self else { return }
				guard self.domainFetchTokens[name] == fetchToken else { return }
				if !isLoadingMore { self.isLoading = false }
				if case .failure(let err) = comp {
					self.isLoadingMoreDomains.remove(name)
					Analytics.logEvent("home_cards_fetch_error", parameters: [
						"domain_id": domain.id as NSString,
						"domain_name": name as NSString,
						"message": err.localizedDescription as NSString
					])
				}
			} receiveValue: { [weak self] (cards: [Card], newLast: DocumentSnapshot?) in
				guard let self else { return }
				guard self.domainFetchTokens[name] == fetchToken else { return }
				
				self.isLoadingMoreDomains.remove(name)
				self.lastDocumentPerDomain[name] = newLast
				
				let readSet = self.readCardIds[name] ?? []
				var filtered = cards.filter { card in
					(self.forcedDeepLinkedCard?.cardID == card.id) || !readSet.contains(card.id)
				}
				
				if !isLoadingMore {
					filtered = RankingService.shared.rank(cards: filtered, topicName: name)
					self.mergeFetchedCards(filtered, for: domain)
				} else {
					if filtered.isEmpty {
						self.noMoreCardsAvailable[name] = true
					} else {
						var existing = self.glanceCards[name] ?? []
						for c in filtered where !existing.contains(where: { $0.id == c.id }) {
							existing.append(c)
						}
						self.glanceCards[name] = existing
					}
				}
				
				for c in filtered where self.bookmarkStatuses[c.id] == nil {
					self.servicesLocator.bookmarksService.isCardBookmarked(cardId: c.id) { b in
						DispatchQueue.main.async { self.bookmarkStatuses[c.id] = b }
					}
				}
			}
		
		var arr = domainFetchCancellables[name] ?? []
		arr.append(c)
		domainFetchCancellables[name] = arr
	}
	
	// ─────────── Domain filtering for For You ───────────
	private func filterHomeCardsByDomainPreferences(
		_ cards: [Card],
		preserveCardId: String? = nil,
		overridePrefs: [String: [String]]? = nil
	) -> [Card] {
		guard !cards.isEmpty else { return [] }
		
		let prefs: [String: [String]]
		if let overridePrefs, !overridePrefs.isEmpty {
			prefs = overridePrefs
		} else if let userPrefs = servicesLocator.userService.user?.domainPreferences,
				  !userPrefs.isEmpty {
			prefs = userPrefs
		} else {
			return cards
		}
		
		let allowedDomainIds = Set(prefs.keys)
		guard !allowedDomainIds.isEmpty else { return cards }
		
		var kept: [Card] = []
		kept.reserveCapacity(cards.count)
		
		for card in cards {
			if let preserveCardId, card.id == preserveCardId {
				kept.append(card)
				continue
			}
			guard let domainId = card.domainId,
				  allowedDomainIds.contains(domainId) else { continue }
			kept.append(card)
		}
		
		return kept
	}
	
	// MARK: - Deep links
	
	func handleDeepLink(domainID: String, cardID: String) {
		if !domainsLoaded {
			pendingDeepLink = (domainID, cardID)
			return
		}
		
		let resolved =
		domains.first(where: { $0.id == domainID }) ??
		domains.first(where: { isHomeDomain($0) }) ??
		(domains.first ?? resolvedHomeDomain())
		
		selectedDomain = resolved
		if let idx = domains.firstIndex(where: { $0.id == resolved.id }) {
			lastViewedPageIndex = idx
		}
		
		Analytics.logEvent("home_deeplink_received", parameters: [
			"domain_id": resolved.id as NSString,
			"has_card_id": NSNumber(value: !cardID.isEmpty)
		])
		
		if cardID.isEmpty {
			if glanceCards[resolved.name] == nil {
				fetchGlanceCards(for: resolved)
			}
			return
		}
		
		forcedDeepLinkedCard = (domainName: resolved.name, cardID: cardID)
		if var set = readCardIds[resolved.name] {
			set.remove(cardID)
			readCardIds[resolved.name] = set
		}
		forceDeepLinkedCard(for: resolved, cardID: cardID)
	}
	
	func forceDeepLinkedCard(for domain: Domain, cardID: String) {
		if let cards = glanceCards[domain.name],
		   let card = cards.first(where: { $0.id == cardID }) {
			currentCard = card
			highlightCard(cardID, for: domain)
			ForewordApp.sharedHomeViewModel?.isCardExpanded = true
		} else {
			servicesLocator.cardService.fetchCardById(cardID)
				.receive(on: DispatchQueue.main)
				.sink { _ in } receiveValue: { [weak self] card in
					guard let self, let card else { return }
					var cards = self.glanceCards[domain.name] ?? []
					cards.insert(card, at: 0)
					self.glanceCards[domain.name] = cards
					self.currentCard = card
					self.highlightCard(cardID, for: domain)
					ForewordApp.sharedHomeViewModel?.isCardExpanded = true
				}
				.store(in: &cancellables)
		}
	}
	
	// ─────────── Section Header ───────────
	func handleCardSwipe(card: Card, direction: String) {
		let domain = selectedDomain ?? activeDomains.first
		if let domain {
			Analytics.logEvent("home_card_swipe", parameters: [
				"screen": "home" as NSString,
				"direction": direction as NSString,
				"domain_id": domain.id as NSString,
				"domain_name": domain.name as NSString,
				"card_id": card.id as NSString
			])
		}
	}
	
	// ─────────── Section Header ───────────
	func maybePrefetchIfNeeded(domain: Domain, currentCardId: String, threshold: Int = 5) {
		let name = domain.name
		guard noMoreCardsAvailable[name] != true else { return }
		guard !isLoadingMoreDomains.contains(name) else { return }
		guard let arr = glanceCards[name], !arr.isEmpty else { return }
		guard let idx = arr.firstIndex(where: { $0.id == currentCardId }) else { return }
		
		let remaining = arr.count - (idx + 1)
		if remaining <= threshold {
			isLoadingMoreDomains.insert(name)
			fetchGlanceCards(for: domain, isLoadingMore: true)
		}
	}
	
	private func mergeFetchedCards(_ fetched: [Card], for domain: Domain) {
		var existing = glanceCards[domain.name] ?? []
		let pinned = existing.first
		
		for newCard in fetched {
			if let idx = existing.firstIndex(where: { $0.id == newCard.id }) {
				existing[idx] = newCard
			} else {
				existing.append(newCard)
			}
		}
		
		if let forced = forcedDeepLinkedCard, let idx = existing.firstIndex(where: { $0.id == forced.cardID }) {
			let card = existing.remove(at: idx)
			existing.insert(card, at: 0)
		} else if let pinned,
				  let idx = existing.firstIndex(where: { $0.id == pinned.id }) {
			existing.remove(at: idx)
			existing.insert(pinned, at: 0)
		}
		
		glanceCards[domain.name] = existing
	}
	
	func highlightCard(_ cardID: String, for domain: Domain) {
		guard !cardID.isEmpty, let arr = glanceCards[domain.name] else { return }
		if let card = arr.first(where: { $0.id == cardID }) {
			currentCard = card
		}
	}
	
	// MARK: - Recs & seen-set utilities
	
	private func warmSeenSetIfNeeded() {
		guard !seenSetLoaded, !seenSetLoading else { return }
		guard let uid = Auth.auth().currentUser?.uid else { return }
		seenSetLoading = true
		
		let cutoff = Calendar.current.date(byAdding: .day, value: -seenWindowDays, to: Date()) ?? Date()
		let ts = Timestamp(date: cutoff)
		
		let baseQuery = db.collection("users")
			.document(uid)
			.collection("cardReads")
			.whereField("readAt", isGreaterThanOrEqualTo: ts)
		
		baseQuery.getDocuments { [weak self] snap, _ in
			guard let self else { return }
			var s = Set<String>()
			for d in snap?.documents ?? [] { s.insert(d.documentID) }
			self.seenCardIdsGlobal = s
			self.seenSetLoaded = true
			self.seenSetLoading = false
			
			self.seenListener?.remove()
			self.seenListener = baseQuery.addSnapshotListener { [weak self] changesSnap, _ in
				guard let self, let chs = changesSnap?.documentChanges else { return }
				var s = self.seenCardIdsGlobal
				for ch in chs {
					let id = ch.document.documentID
					switch ch.type {
					case .added, .modified: s.insert(id)
					case .removed: s.remove(id)
					@unknown default: break
					}
				}
				self.seenCardIdsGlobal = s
			}
			
			let cbs = self.onSeenLoaded
			self.onSeenLoaded.removeAll()
			for cb in cbs { cb() }
		}
	}
	
	private func fetchRecentReadIds(days: Int = 28, completion: @escaping (Set<String>) -> Void) {
		guard let uid = Auth.auth().currentUser?.uid else { completion([]); return }
		let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date(timeIntervalSince1970: 0)
		
		db.collection("users")
			.document(uid)
			.collection("cardReads")
			.whereField("readAt", isGreaterThanOrEqualTo: Timestamp(date: cutoff))
			.getDocuments { snap, err in
				guard let docs = snap?.documents, err == nil else { completion([]); return }
				completion(Set(docs.map { $0.documentID }))
			}
	}
	
	private func fetchStageRecommendationsAndMerge(limit: Int) {
		guard let uid = Auth.auth().currentUser?.uid else { return }
		var req = URLRequest(url: stageRecommendationsURL)
		req.httpMethod = "POST"
		req.addValue("application/json", forHTTPHeaderField: "Content-Type")
		let payload: [String: Any] = ["userId": uid, "limit": limit]
		req.httpBody = try? JSONSerialization.data(withJSONObject: payload, options: [])
		
		URLSession.shared.dataTask(with: req) { [weak self] data, _, err in
			guard let self else { return }
			
			if err != nil { return }
			guard
				let data,
				let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
				let arr = json["candidates"] as? [[String: Any]]
			else { return }
			
			var allIds: [String] = []
			var simMap: [String: Double] = [:]
			for o in arr {
				if let id = o["card_id"] as? String {
					allIds.append(id)
					if let ns = o["neighbor_sim"] as? Double { simMap[id] = max(0.0, min(1.0, ns)) }
				}
			}
			guard !allIds.isEmpty else { return }
			
			var recentReads = self.seenCardIdsGlobal
			if recentReads.isEmpty {
				self.fetchRecentReadIds(days: self.seenWindowDays) { ids in
					recentReads = ids
				}
			}
			
			let homeName = self.resolvedHomeName()
			let existingIds = Set(self.glanceCards[homeName]?.map { $0.id } ?? [])
			let sessionReads = self.readCardIds[homeName] ?? Set<String>()
			
			let newIds = allIds.filter {
				!existingIds.contains($0) &&
				!recentReads.contains($0) &&
				!sessionReads.contains($0)
			}
			guard !newIds.isEmpty else { return }
			
			DispatchQueue.main.async {
				for id in newIds { if let v = simMap[id] { self.neighborSimByCardId[id] = v } }
				self.stagedRecIds = newIds
				self.recHydrationCursor = 0
				self.hydrateNextRecPage(pageSize: self.recInitialPageSize, isLoadMore: false)
			}
		}.resume()
	}
	
	private func fetchCardsByIdsAcrossCollections(_ ids: [String], completion: @escaping ([Card]) -> Void) {
		guard !ids.isEmpty else { completion([]); return }
		
		let chunks: [[String]] = stride(from: 0, to: ids.count, by: 10).map { i in
			Array(ids[i..<min(i+10, ids.count)])
		}
		
		let group = DispatchGroup()
		var out: [Card] = []
		var seen = Set<String>()
		
		for chunk in chunks {
			group.enter()
			db.collection("cards")
				.whereField(FieldPath.documentID(), in: chunk)
				.getDocuments { snap, err in
					defer { group.leave() }
					guard let docs = snap?.documents, err == nil else { return }
					for doc in docs {
						var data = doc.data()
						data["id"] = doc.documentID
						if let decoded = try? Firestore.Decoder().decode(Card.self, from: data) {
							if !seen.contains(decoded.id) {
								out.append(decoded)
								seen.insert(decoded.id)
							}
						}
					}
				}
		}
		
		group.notify(queue: .main) { completion(out) }
	}
	
	private func fetchCardsByIds(_ ids: [String], completion: @escaping ([Card]) -> Void) {
		fetchCardsByIdsAcrossCollections(ids, completion: completion)
	}
	
	private func hydrateNextRecPage(pageSize: Int, isLoadMore: Bool) {
		let homeName = resolvedHomeName()
		guard !isHydratingRecs else { isLoadingMoreDomains.remove(homeName); return }
		guard recHydrationCursor < stagedRecIds.count else {
			isLoadingMoreDomains.remove(homeName)
			return
		}
		
		let start = recHydrationCursor
		let end = min(stagedRecIds.count, start + pageSize)
		let slice = Array(stagedRecIds[start..<end])
		isHydratingRecs = true
		
		fetchCardsByIds(slice) { [weak self] recCards in
			guard let self else { return }
			DispatchQueue.main.async {
				let allowedRecs = self.filterHomeCardsByDomainPreferences(recCards)
				let rankedRecs = RankingService.shared.rank(cards: allowedRecs, topicName: homeName, neighborSims: self.neighborSimByCardId)
				
				var combined = self.glanceCards[homeName] ?? []
				for c in rankedRecs where !combined.contains(where: { $0.id == c.id }) {
					combined.append(c)
				}
				self.glanceCards[homeName] = combined
				
				self.recHydrationCursor = end
				self.isHydratingRecs = false
				self.isLoadingMoreDomains.remove(homeName)
			}
		}
	}
}

// MARK: - Fetch cancellation helpers
private extension HomeViewModel {
	func cancelFetches(for domainName: String) {
		if let list = domainFetchCancellables[domainName] {
			list.forEach { $0.cancel() }
		}
		domainFetchCancellables[domainName] = []
	}
}

extension HomeViewModel {
	func focusCardForShelfPreview(domain: Domain, cardID: String) {
		let domainName = domain.name
		guard !domainName.isEmpty, !cardID.isEmpty else { return }
		
		shelfPreviewFocusRequest = ShelfPreviewFocusRequest(
			domainName: domainName,
			cardID: cardID,
			requestID: UUID().uuidString
		)
		
		if let cards = glanceCards[domainName],
		   let card = cards.first(where: { $0.id == cardID }) {
			currentCard = card
			return
		}
		
		forceDeepLinkedCard(for: domain, cardID: cardID)
	}
}
