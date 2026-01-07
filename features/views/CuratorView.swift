import SwiftUI
import Combine
import UIKit
import FirebaseFirestore
import FirebaseAnalytics

struct CuratorView: View {
	@EnvironmentObject var servicesLocator: AppServicesLocator
	@EnvironmentObject var homeViewModel: HomeViewModel
	@Environment(\.colorScheme) private var colorScheme
	@Environment(\.scenePhase) private var scenePhase
	@Environment(\.cardMorphNamespace) var cardMorphNamespace
	@ObservedObject private var subscriptionStatus = SubscriptionStatus.shared
	
	let onDismiss: () -> Void
	let initialCard: Card?
	let pillNamespace: Namespace.ID
	
	@StateObject var viewModel: CuratorViewModel
	
	@State var inputText       = ""
	@State var hintText        = ""
	@State var keyboardHeight: CGFloat = 0
	@State var interactiveFrames: [CGRect] = []
	@State var handleAnimProgress: CGFloat = 0
	
	@State var tappedSuggestionIdx: Int?
	@State var showSuggestions    = true
	let haptic = UIImpactFeedbackGenerator(style: .light)
	
	@State var showReportToast = false
	
	@State var feedbackMap: [UUID: Int] = [:]
	
	let pullToDismissThreshold: CGFloat = 100
	
	let conversationKey: CuratorConversationKey
	
	@State private var inputStackHeight: CGFloat = 0
	
	@Namespace private var suggestionMorphNS
	@State private var morphingSuggestionKey: String? = nil
	
	@State private var showPremium = false
	
	init(
		onDismiss: @escaping () -> Void,
		initialCard: Card?,
		pillNamespace: Namespace.ID
	) {
		self.onDismiss     = onDismiss
		self.initialCard   = initialCard
		self.pillNamespace = pillNamespace
		
		let ck: CuratorConversationKey = {
			if let c = initialCard { return .card(c.id) }
			return .base
		}()
		self.conversationKey = ck
		
		let prompts = CuratorConfig.introPool(forInitialCardExists: initialCard != nil)
		_viewModel = StateObject(
			wrappedValue: CuratorViewModel(
				introductions: prompts,
				initialCard: initialCard,
				conversationKey: ck
			)
		)
	}
	
	var body: some View {
		let fade   = max(0, 1 - handleAnimProgress * 2)
		
		let topSafe      = UIApplication.shared.windows.first?.safeAreaInsets.top ?? 0
		let baseInset: CGFloat = 24
		let bottomInset  = keyboardHeight > 0 ? (keyboardHeight + baseInset) : baseInset
		let reachedLimit = viewModel.isExchangeLimitReached
		
		ZStack(alignment: .bottom) {
			BlurView(style: .systemThinMaterial, intensity: 0.1)
				.ignoresSafeArea()
			
			VStack(spacing: 0) {
				chatArea
				
				if reachedLimit {
					VStack(spacing: 12) {
						Text("Max daily exchanges reached")
							.font(.custom("Avenir", size: 16))
							.foregroundColor(.secondary)
							.frame(maxWidth: .infinity)
						
						if !subscriptionStatus.isPremiumUser {
							Button {
								var params: [String: Any] = [
									"screen": "curator" as NSString,
									"trigger": "limit_banner" as NSString
								]
								if let cid = initialCard?.id { params["card_id"] = cid as NSString }
								Analytics.logEvent("curator_premium_cta_tap", parameters: params)
								showPremium = true
							} label: {
								Text("Get unlimited with Ponder+")
									.font(.custom("Avenir", size: 15))
									.foregroundColor(Color(.systemBackground))
									.padding(.horizontal, 24)
									.padding(.vertical, 10)
									.frame(maxWidth: .infinity)
									.background(Color("AccentSecondary"))
									.clipShape(Capsule())
							}
							.padding(.horizontal, 32)
						}
						
						CloseButton(systemName: "xmark", size: 40) {
							haptic.impactOccurred()
							var params: [String: Any] = [
								"screen": "curator" as NSString,
								"trigger": "limit_banner_x_button" as NSString
							]
							if let cid = initialCard?.id { params["card_id"] = cid as NSString }
							if let tid = initialCard?.topic { params["topic_id"] = tid as NSString }
							Analytics.logEvent("curator_close_tap", parameters: params)
							dismissView()
						}
						.accessibilityLabel("Dismiss")
						.padding(.top, 4)
					}
					.padding(.bottom, bottomInset)
					.zIndex(2)
				} else {
					textInputStack(bottomInset: bottomInset)
				}
			}
			.padding(.top, topSafe)
		}
		.overlay(alignment: .top) {
			if showReportToast {
				ReportToastView()
					.padding(.top, topSafe + 12)
					.transition(.move(edge: .top).combined(with: .opacity))
					.zIndex(10)
			}
		}
		.coordinateSpace(name: "root")
		.opacity(fade)
		.ignoresSafeArea(.keyboard, edges: .bottom)
		
		.simultaneousGesture(
			DragGesture(minimumDistance: 20, coordinateSpace: .named("root"))
				.onEnded { value in
					let dy = value.translation.height
					let dx = value.translation.width
					guard dy > 30 && abs(dy) > abs(dx) else { return }
					dismissKeyboard()
				}
		)
		
		.onPreferenceChange(InteractiveFrameKey.self) { interactiveFrames = $0 }
		.onAppear {
			let sessionMeta = CuratorSessionStore.shared.ensureSession(for: conversationKey)
			let sid = sessionMeta.id
			haptic.impactOccurred()
			onAppearTasks()
			
			if viewModel.suppressSuggestions {
				showSuggestions = false
				var hideParams: [String: Any] = ["screen": "curator" as NSString]
				hideParams["trigger"] = "history_present" as NSString
				if let cid = initialCard?.id { hideParams["card_id"] = cid as NSString }
				Analytics.logEvent("curator_suggestions_hide", parameters: hideParams)
			}
			
			var openParams: [String: Any] = [
				"open_mode": "text" as NSString,
				"session_id": sid as NSString
			]
			if let cid = initialCard?.id { openParams["card_id"] = cid as NSString }
			Analytics.logEvent("curator_open", parameters: openParams)
			
			let (seed, seedTrigger) = CuratorView.consumeNextLaunchUserSubmit()
			if let seed {
				var params: [String: Any] = [
					"screen": "curator" as NSString,
					"trigger": seedTrigger as NSString,
					"length": NSNumber(value: seed.count)
				]
				if let cid = initialCard?.id { params["card_id"] = cid as NSString }
				if let tid = initialCard?.topic { params["topic_id"] = tid as NSString }
				Analytics.logEvent("curator_seed_submit", parameters: params)
				
				DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
					self.viewModel.sendUserMessage(seed)
					withAnimation(.easeInOut(duration: 0.25)) { self.showSuggestions = false }
					self.dismissKeyboard()
				}
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { notif in
			if let frame = notif.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
				keyboardHeight = frame.height
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
			keyboardHeight = 0
		}
		.onChange(of: viewModel.suggestionsReady) { ready in
			guard ready else { return }
			if viewModel.suppressSuggestions {
				withAnimation(.easeInOut(duration: 0.25)) { showSuggestions = false }
				var params: [String: Any] = [
					"screen": "curator" as NSString,
					"count": NSNumber(value: viewModel.suggestions.count),
					"trigger": "history_present" as NSString
				]
				if let cid = initialCard?.id { params["card_id"] = cid as NSString }
				Analytics.logEvent("curator_suggestions_suppress", parameters: params)
			} else {
				withAnimation(.easeInOut(duration: 0.25)) { showSuggestions = true }
				var params: [String: Any] = [
					"screen": "curator" as NSString,
					"count": NSNumber(value: viewModel.suggestions.count),
					"trigger": "ready" as NSString
				]
				if let cid = initialCard?.id { params["card_id"] = cid as NSString }
				Analytics.logEvent("curator_suggestions_show", parameters: params)
			}
		}
		.onChange(of: viewModel.isExchangeLimitReached) { reached in
			guard reached else { return }
			guard !subscriptionStatus.isPremiumUser else { return }
			guard !CuratorView.hasShownPremiumLimitInterstitialThisSession else { return }
			
			CuratorView.hasShownPremiumLimitInterstitialThisSession = true
			
			var params: [String: Any] = [
				"screen": "curator" as NSString,
				"trigger": "limit_hit_auto" as NSString
			]
			if let cid = initialCard?.id { params["card_id"] = cid as NSString }
			Analytics.logEvent("curator_premium_interstitial_show", parameters: params)
			showPremium = true
		}
		.onChange(of: scenePhase) { phase in
			if phase == .background {
				persistCuratorHistory(finalize: false)
			}
		}
		.fullScreenCover(isPresented: $showPremium) {
			PremiumView()
		}
	}
	
	// ─────────── Main chat area ───────────
	@ViewBuilder
	var chatArea: some View {
		ScrollViewReader { proxy in
			Group {
				if #available(iOS 17.0, *) {
					ScrollView(showsIndicators: false) {
						LazyVStack(spacing: 24) {
							if let c = effectiveInitialCard {
								headerCardBubble(c)
							}
							
							ForEach(Array(viewModel.messages.enumerated()), id: \.element.id) { idx, m in
								threadRow(for: m, index: idx)
							}
							.animation(.easeInOut(duration: 0.3),
									   value: viewModel.messages.count)
							
							Color.clear
								.frame(height: 1)
								.id("BOTTOM")
						}
						.padding(.top, 20)
						.padding(.horizontal, 22)
						.padding(.bottom, inputStackHeight + 12)
					}
					.onScrollGeometryChange(for: CGFloat.self) { _ in 0 } action: { _, _ in }
					.scrollDisabled(false)
					.frame(maxHeight: .infinity)
					.mask(maskGradient)
					.onChange(of: viewModel.messages.count) { _ in
						scrollToBottom(proxy)
					}
					.onChange(of: keyboardHeight) { _ in
						scrollToBottom(proxy)
					}
				} else {
					ScrollView(showsIndicators: false) {
						Color.clear
							.frame(height: 1)
							.background(
								GeometryReader { geo in
									Color.clear.preference(
										key: ScrollTopOffsetKey.self,
										value: geo.frame(in: .named("curatorScroll")).minY
									)
								}
							)
						
						LazyVStack(spacing: 24) {
							if let c = effectiveInitialCard {
								headerCardBubble(c)
							}
							
							ForEach(Array(viewModel.messages.enumerated()), id: \.element.id) { idx, m in
								threadRow(for: m, index: idx)
							}
							.animation(.easeInOut(duration: 0.3),
									   value: viewModel.messages.count)
							
							Color.clear
								.frame(height: 1)
								.id("BOTTOM")
						}
						.padding(.top, 20)
						.padding(.horizontal, 22)
						.padding(.bottom, inputStackHeight + 12)
					}
					.coordinateSpace(name: "curatorScroll")
					.onPreferenceChange(ScrollTopOffsetKey.self) { _ in }
					.scrollDisabled(false)
					.frame(maxHeight: .infinity)
					.mask(maskGradient)
					.onChange(of: viewModel.messages.count) { _ in
						scrollToBottom(proxy)
					}
					.onChange(of: keyboardHeight) { _ in
						scrollToBottom(proxy)
					}
				}
			}
		}
	}
	
	// ─────────── One thread row ───────────
	@ViewBuilder
	func threadRow(for m: ChatMessage, index: Int) -> some View {
		let lastAssistantIndex = viewModel.messages.lastIndex(where: { !$0.isUser }) ?? -1
		let isLastAssistant    = index == lastAssistantIndex
		
		let isSpecialty =
		m.video != nil || m.track != nil || m.movie != nil || m.image != nil ||
		m.stock != nil || m.book != nil || m.restaurant != nil ||
		m.politician != nil || m.athlete != nil || m.team != nil
		
		let isPlaceholder = (m.text.map(CuratorConfig.isLoadingPlaceholder) ?? false)
		
		let showToolbar = !m.isUser && isLastAssistant && !isSpecialty && !isPlaceholder && index != 0
		
		VStack(alignment: m.isUser ? .trailing : .leading, spacing: 10) {
			HStack {
				if m.isUser { Spacer() }
				bubbleView(for: m)
				if !m.isUser { Spacer() }
			}
			
			if showToolbar {
				CuratorToolbar(
					canCopy: (m.text?.isEmpty == false) && !isPlaceholder,
					isThumbsUp: (feedbackMap[m.id] ?? 0) == 1,
					isThumbsDown: (feedbackMap[m.id] ?? 0) == -1,
					onCopy: { copyMessage(m) },
					onThumbsUp: { handleFeedbackTap(message: m, desired: 1) },
					onThumbsDown: { handleFeedbackTap(message: m, desired: -1) },
					onRefresh: { refreshResponse(for: m) }
				)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
	}
	
	// ─────────── Bubble content ───────────
	@ViewBuilder
	func bubbleView(for m: ChatMessage) -> some View {
		if m.isUser {
			let mk = suggestionMorphKey(for: m.text ?? "")
			let base = MessageBubble(message: m.text ?? "", isUser: true)
				.frame(maxWidth: .infinity, alignment: .trailing)
				.overlay(InteractiveFrameReader())
			
			if morphingSuggestionKey == mk {
				base
					.matchedGeometryEffect(
						id: mk,
						in: suggestionMorphNS,
						properties: [.position, .size],
						anchor: .topLeading
					)
					.zIndex(3)
					.onAppear {
						var params: [String: Any] = ["screen": "curator" as NSString, "trigger": "arrive" as NSString]
						if let cid = initialCard?.id { params["card_id"] = cid as NSString }
						Analytics.logEvent("curator_suggestion_morph_end", parameters: params)
						DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
							withAnimation(.easeInOut(duration: 0.2)) { morphingSuggestionKey = nil }
						}
					}
			} else {
				base
			}
		} else {
			let isLoading = (m.text.map(CuratorConfig.isLoadingPlaceholder) ?? false)
			let base = MessageBubble(message: m.text ?? "", isUser: false)
				.frame(maxWidth: .infinity, alignment: .leading)
				.overlay(InteractiveFrameReader())
			
			if isLoading {
				base.shimmer()
			} else {
				base
			}
		}
	}
	
	func headerCardBubble(_ card: Card) -> some View {
		HStack {
			Spacer()
			CardBubble(
				headline: card.headline ?? "",
				bodyText: card.body ?? ""
			)
			.overlay(InteractiveFrameReader())
			.modifier(CuratorMorphEffect(
				id: card.id,
				namespace: cardMorphNamespace,
				enabled: true
			))
			Spacer()
		}
	}
	
	// ─────────── Input stack ───────────
	@ViewBuilder
	func textInputStack(bottomInset: CGFloat) -> some View {
		let shouldShowSuggestions = showSuggestions && !viewModel.suppressSuggestions
		
		VStack(spacing: 10) {
			if shouldShowSuggestions {
				askSuggestionsView
			}
			
			if let s = viewModel.threadSuggestion,
			   !s.isEmpty {
				HStack {
					Spacer()
					let key = suggestionMorphKey(for: s)
					CuratorSuggestionItem(label: s, centered: true) {
						haptic.impactOccurred()
						morphingSuggestionKey = key
						var tapParams: [String: Any] = [
							"screen": "curator" as NSString,
							"position": NSNumber(value: 0),
							"trigger": "thread" as NSString
						]
						if let cid = initialCard?.id { tapParams["card_id"] = cid as NSString }
						if let tid = initialCard?.topic { tapParams["topic_id"] = tid as NSString }
						Analytics.logEvent("curator_thread_suggestion_tap", parameters: tapParams)
						Analytics.logEvent("curator_thread_suggestion_morph_begin", parameters: ["screen": "curator" as NSString])
						viewModel.sendUserMessage(s)
						dismissKeyboard()
						DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
							withAnimation(.easeInOut(duration: 0.25)) { showSuggestions = false }
						}
					}
					.frame(maxWidth: .infinity, alignment: .center)
					.matchedGeometryEffect(
						id: key,
						in: suggestionMorphNS,
						properties: [.position, .size],
						anchor: .topLeading,
						isSource: morphingSuggestionKey == key
					)
					.onAppear {
						var showParams: [String: Any] = [
							"screen": "curator" as NSString,
							"trigger": "after_response" as NSString,
							"length": NSNumber(value: s.count)
						]
						if let cid = initialCard?.id { showParams["card_id"] = cid as NSString }
						if let tid = initialCard?.topic { showParams["topic_id"] = tid as NSString }
						Analytics.logEvent("curator_thread_suggestion_show", parameters: showParams)
					}
					Spacer()
				}
				.transition(.opacity)
			}
			
			CuratorInputBar(
				text: $inputText,
				hintText: hintText,
				onSubmitted: { val in
					guard !viewModel.isExchangeLimitReached else { return }
					haptic.impactOccurred()
					var submitParams: [String: Any] = [
						"input_type": "text" as NSString,
						"length": NSNumber(value: val.count)
					]
					if let cid = initialCard?.id { submitParams["card_id"] = cid as NSString }
					Analytics.logEvent("curator_input_submit", parameters: submitParams)
					viewModel.sendUserMessage(val)
					withAnimation(.easeInOut(duration: 0.25)) { showSuggestions = false }
					dismissKeyboard()
				},
				onVoiceTap: {
					haptic.impactOccurred()
					var tapParams: [String: Any] = [
						"screen": "curator" as NSString,
						"trigger": "input_bar" as NSString
					]
					if let cid = initialCard?.id { tapParams["card_id"] = cid as NSString }
					Analytics.logEvent("curator_mic_tap", parameters: tapParams)
				},
				showDismiss: true,
				onDismiss: {
					dismissKeyboard()
					dismissView()
				},
				analyticsParams: {
					var p: [String: Any] = [:]
					if let cid = initialCard?.id { p["card_id"] = cid as NSString }
					if let tid = initialCard?.topic { p["topic_id"] = tid as NSString }
					return p
				}()
			)
			.curatorPillMatched(in: pillNamespace)
			.background(InteractiveFrameReader())
		}
		.padding(.horizontal, 16)
		.padding(.top, shouldShowSuggestions ? 0 : 8)
		.padding(.bottom, bottomInset)
		.animation(.easeInOut(duration: 0.3), value: shouldShowSuggestions)
		.transition(.opacity)
		.background(
			GeometryReader { geo in
				Color.clear.preference(key: InputStackHeightKey.self, value: geo.size.height)
			}
		)
		.onPreferenceChange(InputStackHeightKey.self) { inputStackHeight = $0 }
	}
	
	@ViewBuilder
	var askSuggestionsView: some View {
		let pad: CGFloat = 8
		if !viewModel.suggestions.isEmpty {
			VStack(alignment: .leading, spacing: 8) {
				let sorted = Array(viewModel.suggestions.enumerated()).sorted { $0.element.count < $1.element.count }
				ForEach(sorted, id: \.offset) { pair in
					let idx = pair.offset
					let raw = pair.element
					let key = suggestionMorphKey(for: raw)
					
					CuratorSuggestionItem(label: raw, centered: false) {
						haptic.impactOccurred()
						morphingSuggestionKey = key
						var tapParams: [String: Any] = [
							"position": NSNumber(value: idx),
							"screen": "curator" as NSString
						]
						if let cid = initialCard?.id { tapParams["card_id"] = cid as NSString }
						Analytics.logEvent("curator_suggestion_tap", parameters: tapParams)
						Analytics.logEvent("curator_suggestion_morph_begin", parameters: ["screen": "curator" as NSString, "position": NSNumber(value: idx)])
						viewModel.sendUserMessage(raw)
						dismissKeyboard()
						DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
							withAnimation(.easeInOut(duration: 0.25)) { showSuggestions = false }
						}
					}
					.frame(maxWidth: .infinity, alignment: .leading)
					.matchedGeometryEffect(
						id: key,
						in: suggestionMorphNS,
						properties: [.position, .size],
						anchor: .topLeading,
						isSource: morphingSuggestionKey == key
					)
					.offset(y: (tappedSuggestionIdx == idx && morphingSuggestionKey != key) ? -pad : 0)
					.opacity(morphingSuggestionKey == key ? 1 : (tappedSuggestionIdx == idx ? 0 : 1))
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, 4)
			.padding(.top, pad)
			.transition(.opacity)
			.animation(.easeInOut(duration: 0.5), value: viewModel.suggestions.count)
			.background(InteractiveFrameReader())
		}
	}
	
	var maskGradient: some View {
		GeometryReader { maskGeo in
			let h = maskGeo.size.height
			let fadeTop: CGFloat = 10
			let fadeBot: CGFloat = 20
			let fadeStart = fadeTop / h
			let fadeEnd   = (h - fadeBot) / h
			
			LinearGradient(
				gradient: Gradient(stops: [
					.init(color: .clear, location: max(0, fadeStart - 0.001)),
					.init(color: .black, location: fadeStart),
					.init(color: .black, location: fadeEnd),
					.init(color: .clear, location: min(1, fadeEnd + 0.001))
				]),
				startPoint: .top, endPoint: .bottom
			)
		}
	}
	
	func scrollToBottom(_ proxy: ScrollViewProxy) {
		proxy.scrollTo("BOTTOM", anchor: .bottom)
	}
	
	func extractMarkdownTable(_ text: String) -> String? {
		let lines = text.components(separatedBy: .newlines)
		for i in 0..<(lines.count - 1) {
			let header  = lines[i]
			let divider = lines[i + 1]
			guard header.contains("|") else { continue }
			
			let cleaned = divider
				.trimmingCharacters(in: .whitespaces)
				.replacingOccurrences(of: " ", with: "")
			
			let pattern = #"^\|?[-:|]+\|?$"#
			if cleaned.range(of: pattern, options: .regularExpression) != nil {
				let rows = lines[i...].prefix(7)
				return rows.joined(separator: "\n")
			}
		}
		return nil
	}
	
	func copyMessage(_ m: ChatMessage) {
		guard let txt = m.text, !txt.isEmpty, !CuratorConfig.isLoadingPlaceholder(txt) else { return }
		CuratorClipboard.copyMarkdownAsPlainText(txt)
		haptic.impactOccurred()
	}
	
	func handleFeedbackTap(message m: ChatMessage, desired: Int) {
		let current = feedbackMap[m.id] ?? 0
		let newValue: Int = (current == desired) ? 0 : desired
		if newValue == 0 {
			feedbackMap.removeValue(forKey: m.id)
		} else {
			feedbackMap[m.id] = newValue
		}
		
		let sessionMeta = CuratorSessionStore.shared.ensureSession(for: conversationKey)
		var params: [String: Any] = [
			"screen": "curator" as NSString,
			"message_id": m.id.uuidString as NSString,
			"choice": (newValue == 1 ? "up" : (newValue == -1 ? "down" : "clear")) as NSString,
			"session_id": sessionMeta.id as NSString
		]
		if let cid = initialCard?.id { params["card_id"] = cid as NSString }
		if let tid = initialCard?.topic { params["topic_id"] = tid as NSString }
		Analytics.logEvent("curator_feedback_tap", parameters: params)
		
		if newValue != 0 {
			if let idx = viewModel.messages.firstIndex(where: { $0.id == m.id }) {
				let lower = max(0, idx - 2)
				let slice = Array(viewModel.messages[lower...idx])
				let convoType: String = (initialCard == nil) ? "base" : "card"
				let cardID: String? = initialCard?.id
				ChatFeedbackService.shared.submitFeedback(
					value: newValue,
					message: m,
					recentMessages: slice,
					sessionID: sessionMeta.id,
					conversationType: convoType,
					cardID: cardID
				)
			}
			
			haptic.impactOccurred()
			withAnimation(.easeInOut) { showReportToast = true }
			DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
				withAnimation(.easeInOut) { showReportToast = false }
			}
		}
	}
	
	func refreshResponse(for message: ChatMessage) {
		guard let prompt = resolveRefreshPrompt(for: message) else { return }
		guard let index = viewModel.messages.firstIndex(where: { $0.id == message.id }) else { return }
		
		feedbackMap.removeValue(forKey: message.id)
		viewModel.messages.remove(at: index)
		
		let sessionMeta = CuratorSessionStore.shared.ensureSession(for: conversationKey)
		var params: [String: Any] = [
			"screen": "curator" as NSString,
			"message_id": message.id.uuidString as NSString,
			"session_id": sessionMeta.id as NSString
		]
		if let cid = initialCard?.id { params["card_id"] = cid as NSString }
		if let tid = initialCard?.topic { params["topic_id"] = tid as NSString }
		Analytics.logEvent("curator_refresh_tap", parameters: params)
		
		haptic.impactOccurred()
		
		Task {
			await viewModel.sendToOpenAIResponses(prompt)
		}
	}
	
	func resolveRefreshPrompt(for message: ChatMessage) -> String? {
		guard let idx = viewModel.messages.firstIndex(where: { $0.id == message.id }) else { return nil }
		
		if idx > 0 {
			for i in stride(from: idx - 1, through: 0, by: -1) {
				let candidate = viewModel.messages[i]
				if candidate.isUser,
				   let text = candidate.text?.trimmingCharacters(in: .whitespacesAndNewlines),
				   !text.isEmpty {
					return text
				}
			}
		}
		
		if let text = message.text?.trimmingCharacters(in: .whitespacesAndNewlines),
		   !text.isEmpty {
			return text
		}
		
		return nil
	}
	
	var effectiveInitialCard: Card? {
		initialCard
	}
}

struct ScrollTopOffsetKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct InputStackHeightKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct CuratorMorphEffect: ViewModifier {
	let id: String
	let namespace: Namespace.ID?
	let enabled: Bool
	
	func body(content: Content) -> some View {
		if enabled, let namespace {
			content.matchedGeometryEffect(
				id: "cardMorph_\(id)",
				in: namespace,
				properties: [.position, .size],
				anchor: .topLeading
			)
		} else {
			content
		}
	}
}

extension CuratorView {
	static var nextLaunchVoice = false
	static func consumeVoiceLaunchFlag() -> Bool {
		let flag = nextLaunchVoice
		nextLaunchVoice = false
		return flag
	}
	
	static var nextLaunchPodcast = false
	static func consumePodcastLaunchFlag() -> Bool {
		let flag = nextLaunchPodcast
		nextLaunchPodcast = false
		return flag
	}
	
	static var nextLaunchFocusKeyboard: Bool = true
	static var nextLaunchFocusTrigger: String = "input_bar"
	static func prepareNextLaunchFocus(shouldFocus: Bool, trigger: String) {
		nextLaunchFocusKeyboard = shouldFocus
		nextLaunchFocusTrigger = trigger
	}
	static func consumeNextLaunchFocus() -> (Bool, String) {
		let flag = nextLaunchFocusKeyboard
		let trig = nextLaunchFocusTrigger
		nextLaunchFocusKeyboard = true
		nextLaunchFocusTrigger = "input_bar"
		return (flag, trig)
	}
	
	static var nextLaunchUserSubmit: String? = nil
	static var nextLaunchUserSubmitTrigger: String = "unknown"
	static func prepareNextLaunchUserSubmit(_ message: String, trigger: String) {
		nextLaunchUserSubmit = message
		nextLaunchUserSubmitTrigger = trigger
	}
	static func consumeNextLaunchUserSubmit() -> (String?, String) {
		let msg = nextLaunchUserSubmit
		let trig = nextLaunchUserSubmitTrigger
		nextLaunchUserSubmit = nil
		nextLaunchUserSubmitTrigger = "unknown"
		return (msg, trig)
	}
	
	static var hasShownPremiumLimitInterstitialThisSession = false
	
	private func onAppearTasks() {
		if viewModel.messages.isEmpty {
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
				guard self.viewModel.messages.isEmpty else { return }
				if self.initialCard == nil &&
					!UserDefaults.standard.bool(forKey: CuratorConfig.userDefaultsIntroKey) {
					let intro = CuratorConfig.onboardingIntro
					self.viewModel.messages.append(.init(text: intro, isUser: false))
					UserDefaults.standard.set(true, forKey: CuratorConfig.userDefaultsIntroKey)
				} else {
					self.viewModel.messages.append(.init(
						text: self.viewModel.introductions.randomElement()!,
						isUser: false
					))
				}
			}
		}
		
		if hintText.isEmpty { hintText = CuratorConfig.defaultHintText }
	}
	
	func suggestionMorphKey(for text: String) -> String {
		"suggMorph_\(text)"
	}
	
	func persistCuratorHistory(finalize: Bool) {
		guard let userId = servicesLocator.userService.getUserId() else { return }
		
		let cleanedMessages = viewModel.messages.filter {
			if let t = $0.text?.trimmingCharacters(in: .whitespacesAndNewlines) {
				return !CuratorConfig.isLoadingPlaceholder(t)
			}
			return true
		}
		
		let hasUserMessage = cleanedMessages.contains(where: { $0.isUser })
		guard hasUserMessage else { return }
		
		let convoType: String
		var cardID: String? = nil
		if let c = initialCard {
			convoType = "card"
			cardID    = c.id
		} else {
			convoType = "base"
		}
		
		let store = CuratorSessionStore.shared
		let sessionMeta = store.ensureSession(for: conversationKey)
		let sessionID = sessionMeta.id
		let startedAt = sessionMeta.startedAt
		let lastSavedCount = store.lastSavedCount(for: conversationKey)
		
		let messagePayload = cleanedMessages.map { serializeMessageForHistory($0) }
		if !finalize && messagePayload.count <= lastSavedCount { return }
		
		let feedbackArray: [[String: Any]] = feedbackMap.map { key, val in
			[
				"id": key.uuidString,
				"value": NSNumber(value: val)
			]
		}
		
		var data: [String: Any] = [
			"userID": userId,
			"sessionID": sessionID,
			"conversationType": convoType,
			"messageCount": messagePayload.count,
			"messages": messagePayload,
			"feedback": feedbackArray,
			"startedAt": startedAt,
			"endedAt": FieldValue.serverTimestamp(),
			"durationSeconds": max(0, Int(Date().timeIntervalSince(startedAt))),
			"finalized": finalize,
			"appVersion": (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "",
		]
		if let cardID { data["cardID"] = cardID }
		if let title = initialCard?.headline { data["threadTitle"] = title }
		
		let ref = Firestore.firestore().collection("historyCurator").document(sessionID)
		ref.setData(data, merge: true) { err in
			if err == nil {
				store.setLastSavedCount(messagePayload.count, for: conversationKey)
			} else {
				print("historyCurator write error: \(err!.localizedDescription)")
			}
		}
	}
	
	func serializeMessageForHistory(_ m: ChatMessage) -> [String: Any] {
		var kind = "text"
		var summary: String? = nil
		
		if let t = m.track {
			kind = "music"
			summary = "\(t.name) by \(t.artist)"
		} else if let v = m.video {
			kind = "video"
			summary = v.title
		} else if let mov = m.movie {
			kind = "movie"
			let title = (mov.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
			let yearText = (mov.year ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
			let yr = yearText.isEmpty ? "" : " (\(yearText))"
			summary = title.isEmpty ? nil : title + yr
		} else if m.image != nil {
			kind = "image"
			summary = nil
		} else if let s = m.stock {
			kind = "stock"
			summary = s.ticker
		} else if let b = m.book {
			kind = "book"
			summary = b.title
		} else if let r = m.restaurant {
			kind = "restaurant"
			summary = r.name
		} else if let pol = m.politician {
			kind = "politician"
			summary = pol.name
		} else if let ath = m.athlete {
			let joined = [ath.name, ath.team].compactMap { $0 }.joined(separator: " • ")
			summary = joined.isEmpty ? (ath.name ?? "the athlete") : joined
		} else if let tm = m.team {
			kind = "team"
			let display = [tm.city, tm.team].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: " ")
			summary = display.isEmpty ? tm.team : display
		}
		
		var dict: [String: Any] = [
			"id": m.id.uuidString,
			"role": m.isUser ? "user" : "assistant",
			"type": kind
		]
		if let t = m.text, !t.isEmpty { dict["text"] = t }
		if let s = summary { dict["summary"] = s }
		return dict
	}
	
	func dismissView() {
		persistCuratorHistory(finalize: true)
		let sid = CuratorSessionStore.shared.ensureSession(for: conversationKey).id
		var params: [String: Any] = [
			"session_id": sid as NSString,
			"message_count": NSNumber(value: viewModel.messages.count)
		]
		if let cid = initialCard?.id { params["card_id"] = cid as NSString }
		Analytics.logEvent("curator_dismiss", parameters: params)
		
		withAnimation(.easeInOut) {
			servicesLocator.visibilityNotifier.mode =
			servicesLocator.visibilityNotifier.priorMode
		}
		onDismiss()
	}
	
	func dismissKeyboard() {
		UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),
										to: nil, from: nil, for: nil)
	}
}
