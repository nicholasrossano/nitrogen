import SwiftUI
import FirebaseAnalytics
import Combine
import UIKit

extension Notification.Name {
	static let stopInlineVideoForCard = Notification.Name("StopInlineVideoForCard")
	static let startInlineVideoForCard = Notification.Name("StartInlineVideoForCard")
	static let inlineVideoSwipeStateChanged = Notification.Name("InlineVideoSwipeStateChanged")
}

struct SwipeableStack: View {
	@Binding var cards: [Card]
	let onSwipeCompleted: (Int, String, Bool) -> Void
	let servicesLocator: AppServicesLocator
	@Binding var showReportMenu: Bool
	let onCardChanged: (Card) -> Void
	
	let topicName: String
	@Binding var showCurator: Bool
	@Binding var isBookmarked: Bool
	var updateBookmarkCache: ((String, Bool) -> Void)?
	
	@Binding var isSwipingCard: Bool
	
	@Binding var shelfPreviewFocusRequest: ShelfPreviewFocusRequest?
	
	@AppStorage("spoiler_protection_enabled") private var spoilerProtectionEnabled: Bool = false
	
	@State private var swipedCards = [(Card, Int)]()
	@State private var stackIndex = 0
	@State private var cancellables = Set<AnyCancellable>()
	@State private var dragOffset: CGSize = .zero
	
	@State private var activeStart: Date? = nil
	@State private var debounceTimer: Timer? = nil
	@State private var dwellTimer: Timer? = nil
	@State private var longReadTimer: Timer? = nil
	@State private var impressionEmittedIds: Set<String> = []
	@State private var readEmittedIds: Set<String> = []
	
	@State private var lastTopicName: String = ""
	@State private var stackIndexByTopic: [String: Int] = [:]
	@State private var swipedCardsByTopic: [String: [(Card, Int)]] = [:]
	
	@State private var activeSwipeCardId: String? = nil
	
	@State private var cardActionSuggestionById: [String: String] = [:]
	@State private var lastNotifiedTopCardId: String? = nil
	
	@State private var revealedSpoilerCardIdsByTopic: [String: Set<String>] = [:]
	
	private let expandedItemWidth : CGFloat = UIScreen.main.bounds.width * 0.9
	private let carouselSpacing: CGFloat = 10
	private let swipeAnimDuration: Double = 0.3
	private let spoilerAnimDuration: Double = 0.28
	
	@Namespace private var cardNS
	
	var cardHeight: CGFloat? = nil
	
	init(
		cards: Binding<[Card]>,
		onSwipeCompleted: @escaping (Int, String, Bool) -> Void,
		servicesLocator: AppServicesLocator,
		showReportMenu: Binding<Bool>,
		onCardChanged: @escaping (Card) -> Void,
		topicName: String,
		showCurator: Binding<Bool>,
		isBookmarked: Binding<Bool>,
		updateBookmarkCache: ((String, Bool) -> Void)? = nil,
		isSwipingCard: Binding<Bool>,
		shelfPreviewFocusRequest: Binding<ShelfPreviewFocusRequest?> = .constant(nil),
		cardHeight: CGFloat? = nil
	) {
		self._cards = cards
		self.onSwipeCompleted = onSwipeCompleted
		self.servicesLocator = servicesLocator
		self._showReportMenu = showReportMenu
		self.onCardChanged = onCardChanged
		
		self.topicName = topicName
		self._showCurator = showCurator
		self._isBookmarked = isBookmarked
		self.updateBookmarkCache = updateBookmarkCache
		
		self._isSwipingCard = isSwipingCard
		self._shelfPreviewFocusRequest = shelfPreviewFocusRequest
		
		self.cardHeight = cardHeight
	}
	
	var body: some View {
		GeometryReader { geometry in
			ZStack(alignment: .center) {
				ForEach(expandedIndices(), id: \.self) { index in
					GlanceCard(
						card: cards[index],
						onTap: {},
						isTopCard: index == stackIndex,
						isSpoilerRevealed: isSpoilerRevealed(cardId: cards[index].id, topicName: topicName),
						hideActionBar: false,
						topicName: topicName,
						isBookmarked: $isBookmarked,
						updateBookmarkCache: updateBookmarkCache,
						showCurator: $showCurator,
						actionSuggestion: cardActionSuggestionById[cards[index].id]
					)
					.id(cards[index].id)
					.matchedGeometryEffect(
						id: cards[index].id,
						in: cardNS,
						isSource: index == stackIndex
					)
					.frame(width: expandedItemWidth, height: cardHeight ?? geometry.size.height)
					.offset(x: CGFloat(index - stackIndex) * (expandedItemWidth + carouselSpacing) + dragOffset.width)
					.overlay(alignment: .center) {
						if index == stackIndex {
							Color.clear
								.frame(width: expandedItemWidth, height: cardHeight ?? geometry.size.height)
								.allowsHitTesting(false)
								.tourTag("home_card")
						}
					}
					.gesture(
						DragGesture()
							.onChanged { value in
								guard index == stackIndex else { return }
								guard stackIndex >= 0 && stackIndex < cards.count else { return }
								
								let currentCardId = cards[stackIndex].id
								if activeSwipeCardId != currentCardId {
									activeSwipeCardId = currentCardId
									NotificationCenter.default.post(
										name: .inlineVideoSwipeStateChanged,
										object: nil,
										userInfo: [
											"cardID": currentCardId,
											"is_swiping": true,
											"will_commit": false,
											"anim_ms": Int(swipeAnimDuration * 1000)
										]
									)
								}
								
								isSwipingCard = true
								dragOffset = CGSize(width: value.translation.width, height: 0)
							}
							.onEnded { value in
								guard index == stackIndex else { return }
								guard stackIndex >= 0 && stackIndex < cards.count else { return }
								
								AppReviewManager.shared.notifyUserAction(.swipeNext)
								
								let swipeThreshold = geometry.size.width * 0.1
								let horizontalDistance = value.translation.width
								let predicted = value.predictedEndTranslation.width
								let willCommit = abs(horizontalDistance) > swipeThreshold || abs(predicted) > swipeThreshold
								
								let currentCardId = cards[stackIndex].id
								NotificationCenter.default.post(
									name: .inlineVideoSwipeStateChanged,
									object: nil,
									userInfo: [
										"cardID": currentCardId,
										"is_swiping": false,
										"will_commit": willCommit,
										"anim_ms": Int(swipeAnimDuration * 1000)
									]
								)
								activeSwipeCardId = nil
								
								isSwipingCard = false
								handleCarouselSwipe(value: value, geometry: geometry)
							}
					)
					.simultaneousGesture(
						TapGesture().onEnded {
							guard index == stackIndex else { return }
							guard stackIndex >= 0 && stackIndex < cards.count else { return }
							handleSpoilerRevealTapIfNeeded(card: cards[stackIndex], trigger: "tap")
						}
					)
					.zIndex(index == stackIndex ? 2 : 1)
				}
			}
			.frame(width: geometry.size.width, height: geometry.size.height)
			.onAppear { handleAppearOrReappear() }
			.onChange(of: topicName) { newTopicName in
				handleTopicChange(newTopicName: newTopicName)
			}
			.onChange(of: cards.count) { _ in
				handleCardsCountChange()
				notifyTopCardIfNeeded()
			}
			.onChange(of: cards) { _ in
				applyShelfPreviewFocusIfNeeded()
				notifyTopCardIfNeeded()
			}
			.onChange(of: shelfPreviewFocusRequest?.requestID) { _ in
				applyShelfPreviewFocusIfNeeded()
				notifyTopCardIfNeeded()
			}
			.onDisappear {
				persistState(for: topicName)
				cancelTimers()
			}
			.onReceive(NotificationCenter.default.publisher(for: Notification.Name("AudioAutoSwipeLeft"))) { notif in
				guard let info = notif.userInfo,
					  let cardID = info["cardID"] as? String else { return }
				if stackIndex < cards.count, cards[stackIndex].id == cardID {
					programmaticLeftSwipe()
				}
			}
		}
	}
	
	private func expandedIndices() -> [Int] {
		guard stackIndex >= 0 && stackIndex < cards.count else { return [] }
		return [stackIndex - 1, stackIndex, stackIndex + 1].filter { $0 >= 0 && $0 < cards.count }
	}
	
	private func handleCarouselSwipe(value: DragGesture.Value, geometry: GeometryProxy) {
		let swipeThreshold = geometry.size.width * 0.1
		let horizontalDistance = value.translation.width
		let predicted          = value.predictedEndTranslation.width
		
		guard abs(horizontalDistance) > swipeThreshold || abs(predicted) > swipeThreshold else {
			withAnimation(.easeInOut(duration: swipeAnimDuration)) { dragOffset = .zero }
			return
		}
		withAnimation(.easeInOut(duration: swipeAnimDuration)) {
			if horizontalDistance < -swipeThreshold {
				advanceCarouselRight(userInitiated: true)
			} else if horizontalDistance > swipeThreshold && stackIndex > 0 {
				retreatCarouselLeft(userInitiated: true)
			}
			dragOffset = .zero
		}
	}
	
	private func advanceCarouselRight(userInitiated: Bool = false) {
		guard stackIndex < cards.count else { return }
		let leavingCard = cards[stackIndex]
		
		NotificationCenter.default.post(
			name: .stopInlineVideoForCard,
			object: nil,
			userInfo: [
				"cardID": leavingCard.id,
				"trigger": (userInitiated ? "swipe" : "programmatic"),
				"defer_ui_close_ms": Int(swipeAnimDuration * 1000)
			]
		)
		
		if stackIndex + 1 < cards.count {
			let card = cards[stackIndex]
			emitReadIfNeeded(card: card, trigger: "swipe")
			swipedCards.append((card, stackIndex))
			onSwipeCompleted(stackIndex, "left", true)
			logSwipe(card: card, direction: "left")
			stackIndex += 1
			persistState(for: topicName)
			
			notifyTopCardIfNeeded()
			
			if stackIndex < cards.count {
				activateCurrentTopCard(mediaAutoplayDelay: swipeAnimDuration + 0.05)
				if userInitiated {
					DispatchQueue.main.asyncAfter(deadline: .now() + swipeAnimDuration) {
						triggerCenterHaptic()
					}
				}
			}
			AppReviewManager.shared.incrementExpandedCardsCount()
		} else {
			let card = cards[stackIndex]
			emitReadIfNeeded(card: card, trigger: "swipe")
			swipedCards.append((card, stackIndex))
			onSwipeCompleted(stackIndex, "left", true)
			logSwipe(card: card, direction: "left")
			stackIndex = cards.count
			persistState(for: topicName)
			
			Analytics.logEvent("finished_card_stack", parameters: [
				"topic_id": (card.topic ?? "unknown") as NSString
			])
			servicesLocator.userActivityService.logAction(
				actionType: "finished_card_stack",
				topicId: card.topic ?? "unknown"
			)
		}
	}
	
	private func retreatCarouselLeft(userInitiated: Bool = false) {
		guard stackIndex > 0 else { return }
		let leavingCard = cards[stackIndex]
		
		NotificationCenter.default.post(
			name: .stopInlineVideoForCard,
			object: nil,
			userInfo: [
				"cardID": leavingCard.id,
				"trigger": (userInitiated ? "swipe" : "programmatic"),
				"defer_ui_close_ms": Int(swipeAnimDuration * 1000)
			]
		)
		
		stackIndex -= 1
		if let last = swipedCards.last, last.1 == stackIndex { swipedCards.removeLast() }
		persistState(for: topicName)
		
		let card = cards[stackIndex]
		notifyTopCardIfNeeded()
		onSwipeCompleted(stackIndex, "right", true)
		logSwipe(card: card, direction: "right")
		activateCurrentTopCard(mediaAutoplayDelay: swipeAnimDuration + 0.05)
		
		if userInitiated {
			DispatchQueue.main.asyncAfter(deadline: .now() + swipeAnimDuration) {
				triggerCenterHaptic()
			}
		}
	}
	
	private func programmaticLeftSwipe() {
		withAnimation(.easeInOut(duration: swipeAnimDuration)) { advanceCarouselRight() }
	}
	
	// ─────────── Topic State ───────────
	private func handleAppearOrReappear() {
		if lastTopicName.isEmpty {
			lastTopicName = topicName
		} else if lastTopicName != topicName {
			persistState(for: lastTopicName)
			lastTopicName = topicName
		}
		
		lastNotifiedTopCardId = nil
		
		restoreState(for: topicName)
		clampStackIndexToCardsBounds()
		
		applyShelfPreviewFocusIfNeeded()
		notifyTopCardIfNeeded()
		activateCurrentTopCard()
	}
	
	private func handleTopicChange(newTopicName: String) {
		persistState(for: lastTopicName)
		lastTopicName = newTopicName
		
		dragOffset = .zero
		cancelTimers()
		
		lastNotifiedTopCardId = nil
		
		restoreState(for: newTopicName)
		clampStackIndexToCardsBounds()
		
		applyShelfPreviewFocusIfNeeded()
		notifyTopCardIfNeeded()
		activateCurrentTopCard()
	}
	
	private func handleCardsCountChange() {
		let previous = stackIndex
		clampStackIndexToCardsBounds()
		guard previous != stackIndex else {
			applyShelfPreviewFocusIfNeeded()
			return
		}
		
		persistState(for: topicName)
		dragOffset = .zero
		cancelTimers()
		
		applyShelfPreviewFocusIfNeeded()
		notifyTopCardIfNeeded()
		activateCurrentTopCard()
	}
	
	private func persistState(for topicName: String) {
		guard !topicName.isEmpty else { return }
		stackIndexByTopic[topicName] = stackIndex
		swipedCardsByTopic[topicName] = swipedCards
	}
	
	private func restoreState(for topicName: String) {
		stackIndex = stackIndexByTopic[topicName] ?? 0
		swipedCards = swipedCardsByTopic[topicName] ?? []
	}
	
	private func clampStackIndexToCardsBounds() {
		if stackIndex < 0 { stackIndex = 0 }
		if stackIndex > cards.count { stackIndex = cards.count }
		if stackIndex == 0, !swipedCards.isEmpty {
			swipedCards.removeAll()
		}
	}
	
	private func applyShelfPreviewFocusIfNeeded() {
		guard let request = shelfPreviewFocusRequest else { return }
		guard request.domainName == topicName else { return }
		guard let targetIndex = cards.firstIndex(where: { $0.id == request.cardID }) else { return }
		
		if targetIndex == stackIndex {
			DispatchQueue.main.async {
				if self.shelfPreviewFocusRequest?.requestID == request.requestID {
					self.shelfPreviewFocusRequest = nil
				}
			}
			return
		}
		
		cancelTimers()
		dragOffset = .zero
		stackIndex = targetIndex
		clampStackIndexToCardsBounds()
		persistState(for: topicName)
		
		notifyTopCardIfNeeded()
		activateCurrentTopCard()
		
		DispatchQueue.main.async {
			if self.shelfPreviewFocusRequest?.requestID == request.requestID {
				self.shelfPreviewFocusRequest = nil
			}
		}
	}
	
	private func notifyTopCardIfNeeded() {
		guard let card = currentTopCard() else { return }
		guard card.id != lastNotifiedTopCardId else { return }
		lastNotifiedTopCardId = card.id
		onCardChanged(card)
	}
	
	// ─────────── Spoilers ───────────
	private func isSpoilerRevealed(cardId: String, topicName: String) -> Bool {
		revealedSpoilerCardIdsByTopic[topicName]?.contains(cardId) ?? false
	}
	
	private func handleSpoilerRevealTapIfNeeded(card: Card, trigger: String) {
		guard !isSportsCard(card) else { return }
		guard spoilerProtectionEnabled else { return }
		guard card.spoiler == true else { return }
		guard !isSpoilerRevealed(cardId: card.id, topicName: topicName) else { return }
		
		withAnimation(.easeInOut(duration: spoilerAnimDuration)) {
			var set = revealedSpoilerCardIdsByTopic[topicName] ?? Set<String>()
			set.insert(card.id)
			revealedSpoilerCardIdsByTopic[topicName] = set
		}
		
		let generator = UIImpactFeedbackGenerator(style: .light)
		generator.impactOccurred()
		
		Analytics.logEvent("card_spoiler_reveal", parameters: [
			"screen": "home" as NSString,
			"card_id": card.id as NSString,
			"topic_id": (card.topic ?? "unknown") as NSString,
			"trigger": trigger as NSString,
			"position": NSNumber(value: stackIndex)
		])
	}
	
	private func isSportsCard(_ card: Card?) -> Bool {
		if let domainName = card?.domainName?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
		   domainName == "sports" {
			return true
		}
		if let domainId = card?.domainId?.trimmingCharacters(in: .whitespacesAndNewlines),
		   domainId == "13" {
			return true
		}
		if card?.domainCategories.contains(where: { $0.hasPrefix("sports_") }) == true {
			return true
		}
		let topic = topicName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		return topic == "sports"
	}
	
	// ─────────── Haptics ───────────
	private func triggerCenterHaptic() {
		let generator = UIImpactFeedbackGenerator(style: .soft)
		generator.impactOccurred(intensity: 0.8)
	}
	
	private func activateCurrentTopCard(mediaAutoplayDelay: Double = 0.05) {
		cancelTimers()
		guard let card = currentTopCard() else { return }
		
		prefetchActionSuggestionsAroundTop()
		
		if !impressionEmittedIds.contains(card.id) {
			Analytics.logEvent("card_impression", parameters: [
				"card_id": card.id as NSString,
				"topic_id": (card.topic ?? "unknown") as NSString,
				"position": NSNumber(value: stackIndex)
			])
			impressionEmittedIds.insert(card.id)
		}
		activeStart = Date()
		let expectedId = card.id
		
		let autoplayEnabled = VideoPlaybackDefaults.loadAutoplayEnabled()
		Analytics.logEvent("home_inline_video_autoplay_signal", parameters: [
			"screen": "home" as NSString,
			"card_id": expectedId as NSString,
			"topic_id": (card.topic ?? "unknown") as NSString,
			"autoplay_enabled": NSNumber(value: autoplayEnabled),
			"trigger": "card_active" as NSString
		])
		
		DispatchQueue.main.asyncAfter(deadline: .now() + mediaAutoplayDelay) {
			guard self.currentTopCard()?.id == expectedId else { return }
			NotificationCenter.default.post(
				name: .startInlineVideoForCard,
				object: nil,
				userInfo: [
					"cardID": expectedId,
					"autoplay_enabled": autoplayEnabled
				]
			)
		}
		
		debounceTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { _ in
			self.dwellTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { _ in
				guard self.currentTopCard()?.id == expectedId else { return }
				self.emitReadIfNeeded(card: card, trigger: "dwell")
			}
		}
		
		longReadTimer = Timer.scheduledTimer(withTimeInterval: 3.5, repeats: false) { _ in
			guard self.currentTopCard()?.id == expectedId else { return }
			Analytics.logEvent("review_deep_engagement", parameters: [
				"screen": "home" as NSString,
				"type": "long_read" as NSString,
				"card_id": card.id as NSString,
				"topic_id": (card.topic ?? "unknown") as NSString,
				"dwell_ms": NSNumber(value: 3500)
			])
			AppReviewManager.shared.recordDeepEngagement(.longRead)
		}
	}
	
	private func prefetchActionSuggestionsAroundTop() {
		guard stackIndex >= 0 && stackIndex < cards.count else { return }
		
		ensureActionSuggestionCached(for: cards[stackIndex])
		
		if stackIndex + 1 < cards.count {
			ensureActionSuggestionCached(for: cards[stackIndex + 1])
		}
		if stackIndex > 0 {
			ensureActionSuggestionCached(for: cards[stackIndex - 1])
		}
	}
	
	private func ensureActionSuggestionCached(for card: Card) {
		if cardActionSuggestionById[card.id] != nil { return }
		
		let conversationKey: CuratorConversationKey = .card(card.id)
		
		if let cached = CuratorSessionStore.shared.cachedSuggestions(for: conversationKey), !cached.isEmpty {
			if let picked = CuratorSuggestionsService.shared.pickActionSuggestion(from: cached) {
				cardActionSuggestionById[card.id] = picked
			}
			return
		}
		
		Task {
			let suggestions = await CuratorSuggestionsService.shared.generateSuggestions(for: card)
			let picked = CuratorSuggestionsService.shared.pickActionSuggestion(from: suggestions)
			
			await MainActor.run {
				if !suggestions.isEmpty {
					CuratorSessionStore.shared.setSuggestions(suggestions, for: conversationKey)
				}
				if let picked {
					cardActionSuggestionById[card.id] = picked
				}
			}
		}
	}
	
	private func emitReadIfNeeded(card: Card, trigger: String) {
		guard !readEmittedIds.contains(card.id) else { return }
		let start = activeStart ?? Date()
		let dwell = max(0, Int(Date().timeIntervalSince(start) * 1000))
		Analytics.logEvent("card_read", parameters: [
			"card_id": card.id as NSString,
			"topic_id": (card.topic ?? "unknown") as NSString,
			"trigger": trigger as NSString,
			"dwell_ms": NSNumber(value: dwell),
			"position": NSNumber(value: stackIndex)
		])
		
		servicesLocator.userActivityService.markCardRead(
			cardId: card.id,
			topicId: card.topic ?? "unknown",
			readTrigger: trigger,
			dwellMs: dwell,
			completion: nil
		)
		readEmittedIds.insert(card.id)
		cancelShortTimers()
	}
	
	private func currentTopCard() -> Card? {
		guard stackIndex >= 0, stackIndex < cards.count else { return nil }
		return cards[stackIndex]
	}
	
	private func cancelShortTimers() {
		debounceTimer?.invalidate(); debounceTimer = nil
		dwellTimer?.invalidate(); dwellTimer = nil
	}
	
	private func cancelTimers() {
		cancelShortTimers()
		longReadTimer?.invalidate(); longReadTimer = nil
	}
	
	private func logSwipe(card: Card, direction: String) {
		if let _ = servicesLocator.userService.getUserId() {
			servicesLocator.cardService
				.logSwipe(cardId: card.id, direction: direction, state: true)
				.sink(receiveCompletion: { _ in }, receiveValue: { })
				.store(in: &cancellables)
		}
	}
}
