import SwiftUI
import UIKit
import FirebaseAnalytics
import NaturalLanguage

struct GlanceCard: View {
	let card: Card?
	let onTap: () -> Void
	let isTopCard: Bool
	let isSpoilerRevealed: Bool
	var hideActionBar: Bool = false
	
	let topicName: String
	@Binding var isBookmarked: Bool
	var updateBookmarkCache: ((String, Bool) -> Void)?
	
	@Binding var showCurator: Bool
	let actionSuggestion: String?
	
	@Environment(\.colorScheme) private var colorScheme
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	@Environment(\.cardMorphNamespace) private var cardMorphNamespace
	
	@AppStorage("spoiler_protection_enabled") private var spoilerProtectionEnabled: Bool = false
	
	@State private var headlineHeight : CGFloat = 0
	@State private var contentHeight  : CGFloat = 0
	@State private var availableHeight: CGFloat = 0
	@State private var localIsBookmarked = false
	@State private var actionBarHeight: CGFloat = 0
	
	@State private var lastActionBarShowCardId: String? = nil
	
	@ObservedObject private var flags = FeatureFlagsManager.shared
	
	private let baseSidePad: CGFloat = 16
	private let collapsedCardW = UIScreen.main.bounds.width * 0.90
	private let minWidgetHeightFraction: CGFloat = 0.30
	private let maxWidgetHeightFraction: CGFloat = 0.50
	private let widgetTargetFraction: CGFloat = 0.35
	
	private let spoilerBlurIntensity: CGFloat = 0
	private let spoilerAnimDuration: Double = 0.28
	
	private let cardCornerRadius: CGFloat = 20
	
	private let bodyLineHeightMultiple: CGFloat = 1.65
	
	private static let ageFormatter: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateFormat = "MMM d"
		formatter.locale = Locale(identifier: "en_US_POSIX")
		return formatter
	}()
	
	init(
		card: Card?,
		isExpanded: Bool = true,
		onTap: @escaping () -> Void,
		isTopCard: Bool,
		isSpoilerRevealed: Bool = false,
		hideActionBar: Bool = false,
		topicName: String,
		isBookmarked: Binding<Bool>,
		updateBookmarkCache: ((String, Bool) -> Void)? = nil,
		showCurator: Binding<Bool> = .constant(false),
		actionSuggestion: String? = nil
	) {
		self.card = card
		self.onTap = onTap
		self.isTopCard = isTopCard
		self.isSpoilerRevealed = isSpoilerRevealed
		self.hideActionBar = hideActionBar
		self.topicName = topicName
		self._isBookmarked = isBookmarked
		self.updateBookmarkCache = updateBookmarkCache
		self._showCurator = showCurator
		self.actionSuggestion = actionSuggestion
	}
	
	var body: some View {
		GeometryReader { geometry in
			let screenW    = UIScreen.main.bounds.width
			let containerH = geometry.size.height
			
			let hasWidget: Bool = WidgetManager.hasAnyWidget(for: card)
			let isLoading = (card == nil)
			
			let widgetHeight: CGFloat = {
				guard (hasWidget || isLoading) else { return 0 }
				let target = containerH * widgetTargetFraction
				return min(
					max(containerH * minWidgetHeightFraction, target),
					containerH * maxWidgetHeightFraction
				)
			}()
			
			let extraWidth  = max(0, geometry.size.width - collapsedCardW)
			let sidePadding = baseSidePad + extraWidth / 2
			let contentAreaH = max(0, containerH - widgetHeight)
			
			let isSportsDomain = isSportsCard(card)
			
			let spoilerBlurActive: Bool = {
				guard !isSportsDomain else { return false }
				guard spoilerProtectionEnabled else { return false }
				guard let c = card else { return false }
				return (c.spoiler == true) && !isSpoilerRevealed
			}()
			
			let maskShape = SpoilerCardMaskShape(
				topRadius: cardCornerRadius,
				bottomRadius: cardCornerRadius
			)
			
			let showNotice = spoilerBlurActive && isTopCard
			
			ZStack {
				cardBaseContent(
					geometry: geometry,
					screenW: screenW,
					widgetHeight: widgetHeight,
					contentAreaH: contentAreaH,
					sidePadding: sidePadding
				)
				.allowsHitTesting(!spoilerBlurActive)
				
				BlurView(style: .systemUltraThinMaterial, intensity: spoilerBlurIntensity, gradientColors: nil)
					.allowsHitTesting(false)
					.opacity(spoilerBlurActive ? 1 : 0)
					.animation(.easeInOut(duration: spoilerAnimDuration), value: spoilerBlurActive)
				
				spoilerNoticeOverlay(headline: card?.headline)
					.allowsHitTesting(false)
					.opacity(showNotice ? 1 : 0)
					.animation(.easeInOut(duration: spoilerAnimDuration), value: showNotice)
				
				if spoilerBlurActive {
					Color.clear
						.contentShape(Rectangle())
						.allowsHitTesting(true)
				}
			}
			.mask(maskShape)
			.onPreferenceChange(ActionBarHeightKey.self) { h in
				if h > 0 && h != actionBarHeight {
					actionBarHeight = h
					withTransaction(Transaction(animation: nil)) {
						availableHeight = max(0, containerH - widgetHeight)
					}
				}
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.compositingGroup()
			.shadow(
				color: .black.opacity(0.2),
				radius: 6,
				x: 0,
				y: 4
			)
		}
	}
	
	// ─────────── Section Header ───────────
	private func cardBaseContent(
		geometry: GeometryProxy,
		screenW: CGFloat,
		widgetHeight: CGFloat,
		contentAreaH: CGFloat,
		sidePadding: CGFloat
	) -> some View {
		let hasWidget: Bool = WidgetManager.hasAnyWidget(for: card)
		let isLoading = (card == nil)
		
		return VStack(spacing: 0) {
			if hasWidget, let validCard = card {
				WidgetBarContainer(card: validCard, geometry: geometry, barHeight: widgetHeight)
					.frame(height: widgetHeight)
					.clipped()
			} else if isLoading, widgetHeight > 0 {
				RoundedCorner(radius: cardCornerRadius, corners: [.topLeft, .topRight])
					.fill(Color.gray.opacity(0.25))
					.frame(maxWidth: .infinity)
					.frame(height: widgetHeight)
					.overlay(
						RoundedCorner(radius: cardCornerRadius, corners: [.topLeft, .topRight])
							.stroke(Color.white.opacity(0.7), lineWidth: 0.5)
					)
			}
			
			ZStack {
				cardInnerContent(
					screenW: screenW,
					sidePadding: sidePadding,
					containerWidth: geometry.size.width
				)
			}
			.frame(height: contentAreaH)
			.clipped()
			.background(Color.customSystemGray(for: colorScheme))
			.clipShape(
				RoundedCorner(
					radius: cardCornerRadius,
					corners: {
						let baseCorners = WidgetManager.clipCorners(
							isExpanded: true,
							hasWidget:  hasWidget || isLoading
						)
						return baseCorners.union(.bottomRight)
					}()
				)
			)
			.onAppear {
				withTransaction(Transaction(animation: nil)) {
					availableHeight = contentAreaH
				}
				primeBookmarkState()
			}
			.onChange(of: card?.id) { _ in
				primeBookmarkState()
			}
			.modifier(MorphEffect(
				id: card?.id,
				namespace: cardMorphNamespace
			))
			.overlay(alignment: .bottom) {
				if let card = card {
					bottomOverlay(card: card)
				}
			}
		}
	}
	
	private func bottomOverlay(card: Card) -> some View {
		let suggested = actionSuggestion?.trimmingCharacters(in: .whitespacesAndNewlines)
		let shouldShowSuggested = !hideActionBar && (suggested?.isEmpty == false)
		
		return VStack(alignment: .leading, spacing: 8) {
			if shouldShowSuggested, let suggested {
				CardActionBar(
					label: suggested,
					onTap: { handleSuggestedQuestionTap(question: suggested, card: card, trigger: "bar") },
					onIconTap: { handleSuggestedQuestionTap(question: suggested, card: card, trigger: "icon") }
				)
				.onAppear {
					logSuggestedQuestionShowIfNeeded(question: suggested, card: card)
				}
			}
			
			HStack(alignment: .bottom, spacing: 8) {
				HStack(spacing: 8) {
					if let ts = card.timestamp { agePill(for: ts) }
					WidgetManager.iconOverlay(for: card)
				}
				.allowsHitTesting(false)
				
				Spacer()
				
				if !hideActionBar {
					ActionCapsule(
						card:                card,
						cardId:              card.id,
						topicId:             card.topic ?? "",
						headline:            card.headline ?? "",
						topicName:           topicName,
						sources:             card.sources ?? [],
						isBookmarked:        $localIsBookmarked,
						updateBookmarkCache: updateBookmarkCache
					)
					.environmentObject(servicesLocator)
					.tourTag("home_action_capsule")
				}
			}
		}
		.padding(.horizontal, 8)
		.padding(.bottom, 8)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			GeometryReader { proxy in
				Color.clear.preference(key: ActionBarHeightKey.self, value: proxy.size.height)
			}
		)
	}
	
	private func logSuggestedQuestionShowIfNeeded(question: String, card: Card) {
		guard lastActionBarShowCardId != card.id else { return }
		lastActionBarShowCardId = card.id
		
		let params: [String: Any] = [
			"screen": "home" as NSString,
			"card_id": card.id as NSString,
			"topic_id": (card.topic ?? "unknown") as NSString,
			"length": NSNumber(value: question.count)
		]
		Analytics.logEvent("card_action_bar_show", parameters: params)
	}
	
	private func handleSuggestedQuestionTap(question: String, card: Card, trigger: String) {
		let haptic = UIImpactFeedbackGenerator(style: .light)
		haptic.impactOccurred()
		
		let params: [String: Any] = [
			"screen": "home" as NSString,
			"card_id": card.id as NSString,
			"topic_id": (card.topic ?? "unknown") as NSString,
			"trigger": trigger as NSString,
			"length": NSNumber(value: question.count)
		]
		Analytics.logEvent("card_action_bar_tap", parameters: params)
		
		CuratorView.prepareNextLaunchUserSubmit(question, trigger: "card_action_bar_\(trigger)")
		CuratorView.prepareNextLaunchFocus(shouldFocus: false, trigger: "card_action_bar_\(trigger)")
		servicesLocator.visibilityNotifier.priorMode = servicesLocator.visibilityNotifier.mode
		servicesLocator.visibilityNotifier.mode = .curatorMode
		showCurator = true
	}
	
	private func primeBookmarkState() {
		guard let id = card?.id else { return }
		servicesLocator.bookmarksService.isCardBookmarked(cardId: id) { isBk in
			DispatchQueue.main.async {
				localIsBookmarked = isBk
				isBookmarked      = isBk
				updateBookmarkCache?(id, isBk)
			}
		}
	}
	
	@ViewBuilder
	private func cardInnerContent(screenW: CGFloat, sidePadding: CGFloat, containerWidth: CGFloat) -> some View {
		if let card {
			let headlineFont = screenW * 0.045
			let bodyFontSize = max(14, screenW * 0.037)
			
			let bodyLineSpacingPoints = bodyFontSize * max(0, bodyLineHeightMultiple - 1.0)
			let bodyPerLineHeight = bodyFontSize * bodyLineHeightMultiple
			
			VStack(alignment: .leading, spacing: 16) {
				Text(card.headline ?? "No headline available")
					.dynamicTypeSize(.medium ... .large)
					.font(.custom("Didot", size: headlineFont))
					.kerning(-0.5)
					.foregroundColor(.black)
					.lineLimit(2)
					.minimumScaleFactor(0.80)
					.allowsTightening(true)
					.background(
						GeometryReader { g in
							Color.clear.onAppear {
								headlineHeight = g.size.height
							}
						}
					)
				
				if let body = card.body {
					let cleanedBody = body.cleanedContent()
					
					let baseAttrBodyRaw = cleanedBody.toAvenirAttributedString(baseSize: bodyFontSize)
					let baseAttrBody = withLineSpacing(baseAttrBodyRaw, lineSpacing: bodyLineSpacingPoints)
					
					let lineLimit = max(0, calculateLineLimit(
						totalHeight: availableHeight,
						headlineHeight: headlineHeight,
						bodyFontSize: bodyFontSize
					))
					
					let measuredHeight = measureBodyHeight(baseAttrBody, width: max(0, containerWidth - 2 * sidePadding))
					let approxLinesNeeded = Int(ceil(measuredHeight / max(1, bodyPerLineHeight)))
					let shouldScroll = approxLinesNeeded > lineLimit
					
					if shouldScroll {
						ScrollView(.vertical, showsIndicators: true) {
							Text(AttributedString(baseAttrBody))
								.dynamicTypeSize(.medium ... .medium)
								.foregroundColor(.black)
								.lineLimit(nil)
								.truncationMode(.tail)
						}
						.id("body-scroll-\(card.id)")
					} else {
						let scaleFactor = bodyScaleFactor(
							measuredHeight: measuredHeight,
							lineLimit: lineLimit,
							bodyFontSize: bodyFontSize
						)
						
						let scaledAttrBodyRaw = cleanedBody.toAvenirAttributedString(baseSize: bodyFontSize * scaleFactor)
						let scaledAttrBody = withLineSpacing(scaledAttrBodyRaw, lineSpacing: bodyLineSpacingPoints * scaleFactor)
						
						ScrollView([]) {
							Text(AttributedString(scaledAttrBody))
								.dynamicTypeSize(.medium ... .medium)
								.foregroundColor(.black)
								.lineLimit(lineLimit)
								.truncationMode(.tail)
						}
						.id("body-scroll-\(card.id)")
					}
				}
			}
			.padding(.horizontal, sidePadding)
			.padding(.top, 16)
			.padding(.bottom, actionBarHeight + 16)
		} else {
			GeometryReader { geo in
				VStack(alignment: .leading, spacing: 10) {
					Rectangle()
						.fill(Color.gray.opacity(0.3))
						.frame(width: geo.size.width * 0.8, height: geo.size.height * 0.15)
						.cornerRadius(5)
						.padding(.top, 16)
						.padding(.bottom, 10)
						.shimmer()
					
					ForEach(0..<5, id: \.self) { _ in
						Rectangle()
							.fill(Color.gray.opacity(0.3))
							.frame(height: 20)
							.cornerRadius(5)
							.padding(.vertical, 5)
							.shimmer()
					}
				}
				.padding(.horizontal, sidePadding)
				.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
			}
		}
	}
	
	private func agePill(for ts: Date) -> some View {
		Text(calculateCardAge(from: ts))
			.font(.system(size: 12, weight: .medium))
			.foregroundColor(.white)
			.padding(.horizontal, 10)
			.padding(.vertical, 4)
			.background(Color.black.opacity(colorScheme == .light ? 0.30 : 0.50))
			.cornerRadius(20)
	}
	
	private func calculateLineLimit(totalHeight: CGFloat, headlineHeight: CGFloat, bodyFontSize: CGFloat) -> Int {
		let available = totalHeight - headlineHeight - 8 - 24
		return Int(max(0, available) / max(1, bodyFontSize * bodyLineHeightMultiple))
	}
	
	private func calculateCardAge(from ts: Date) -> String {
		let cal = Calendar.current
		let now = Date()
		
		if cal.isDateInToday(ts) {
			return "Today"
		}
		
		if cal.isDateInYesterday(ts) {
			return "1 day"
		}
		
		if let d = cal.dateComponents([.day], from: ts, to: now).day, d < 7, d >= 0 {
			return "\(d) days"
		}
		
		return Self.ageFormatter.string(from: ts)
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
	
	private func measureBodyHeight(_ attrBody: NSAttributedString, width: CGFloat) -> CGFloat {
		guard width > 0 else { return 0 }
		let size = attrBody.boundingRect(
			with: CGSize(width: width, height: .greatestFiniteMagnitude),
			options: [.usesLineFragmentOrigin, .usesFontLeading],
			context: nil
		).size
		return ceil(size.height)
	}
	
	private func withLineSpacing(_ attr: NSAttributedString, lineSpacing: CGFloat) -> NSAttributedString {
		guard attr.length > 0 else { return attr }
		let mutable = NSMutableAttributedString(attributedString: attr)
		let fullRange = NSRange(location: 0, length: mutable.length)
		
		mutable.enumerateAttribute(.paragraphStyle, in: fullRange, options: []) { value, range, _ in
			let style = (value as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
			style.lineSpacing = lineSpacing
			mutable.addAttribute(.paragraphStyle, value: style, range: range)
		}
		
		return mutable
	}
	
	private func bodyScaleFactor(measuredHeight: CGFloat, lineLimit: Int, bodyFontSize: CGFloat) -> CGFloat {
		guard measuredHeight > 0, lineLimit > 0 else { return 1 }
		let targetHeight = CGFloat(lineLimit) * bodyFontSize * bodyLineHeightMultiple
		let scale = min(1, targetHeight / measuredHeight)
		return max(0.75, scale)
	}
	
	// ─────────── Section Header ───────────
	private func spoilerNoticeOverlay(headline: String?) -> some View {
		let about = spoilerAboutPhraseFromHeadline(headline)
		let msg: String = {
			if let about, !about.isEmpty {
				return "This card may contain spoilers about \(about). Tap to unhide."
			}
			return "This card may contain spoilers. Tap to unhide."
		}()
		
		return VStack {
			Spacer()
			HStack(alignment: .center, spacing: 10) {
				Image(systemName: "eye.slash.fill")
					.font(.system(size: 16, weight: .semibold))
					.foregroundColor(.white)
					.shadow(color: .black.opacity(0.35), radius: 8, x: 0, y: 3)
				
				Text(msg)
					.font(.custom("Avenir", size: 15))
					.foregroundColor(.white)
					.multilineTextAlignment(.leading)
					.lineLimit(3)
					.shadow(color: .black.opacity(0.35), radius: 8, x: 0, y: 3)
			}
			.padding(.horizontal, 18)
			.padding(.top, 18)
			Spacer()
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}
	
	private func spoilerAboutPhraseFromHeadline(_ headline: String?) -> String? {
		guard let h = headline?.trimmingCharacters(in: .whitespacesAndNewlines), !h.isEmpty else { return nil }
		let entities = spoilerNamedEntities(in: h)
		guard !entities.isEmpty else { return nil }
		
		if entities.count == 1 { return entities[0] }
		if entities.count == 2 { return "\(entities[0]) and \(entities[1])" }
		return "\(entities[0]), \(entities[1]), and \(entities[2])"
	}
	
	private func spoilerNamedEntities(in headline: String) -> [String] {
		let tagger = NLTagger(tagSchemes: [.nameType])
		tagger.string = headline
		
		let range = headline.startIndex..<headline.endIndex
		var out: [String] = []
		var seen = Set<String>()
		
		let options: NLTagger.Options = [.omitWhitespace, .omitPunctuation, .joinNames]
		
		tagger.enumerateTags(in: range, unit: .word, scheme: .nameType, options: options) { tag, tokenRange in
			guard let tag else { return true }
			guard tag == .personalName || tag == .placeName || tag == .organizationName else { return true }
			
			let raw = String(headline[tokenRange]).trimmingCharacters(in: .whitespacesAndNewlines)
			let cleaned = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\"“”'"))
			guard cleaned.count >= 2 else { return true }
			
			let key = cleaned.lowercased()
			guard !seen.contains(key) else { return true }
			
			seen.insert(key)
			out.append(cleaned)
			
			return out.count < 3
		}
		
		return out
	}
}

private struct MorphEffect: ViewModifier {
	let id: String?
	let namespace: Namespace.ID?
	
	func body(content: Content) -> some View {
		if let namespace, let id {
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

private struct ActionBarHeightKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
		let n = nextValue()
		if n > 0 { value = n }
	}
}

extension Color {
	static func customSystemGray(for scheme: ColorScheme) -> Color {
		scheme == .light ? Color(white: 0.90) : Color(white: 0.7)
	}
}

private struct SpoilerCardMaskShape: Shape {
	let topRadius: CGFloat
	let bottomRadius: CGFloat
	
	func path(in rect: CGRect) -> Path {
		let tl = max(0, min(topRadius, min(rect.width, rect.height) / 2))
		let tr = tl
		let bl = max(0, min(bottomRadius, min(rect.width, rect.height) / 2))
		let br = bl
		
		let minX = rect.minX
		let minY = rect.minY
		let maxX = rect.maxX
		let maxY = rect.maxY
		
		var p = Path()
		
		p.move(to: CGPoint(x: minX + tl, y: minY))
		p.addLine(to: CGPoint(x: maxX - tr, y: minY))
		p.addArc(center: CGPoint(x: maxX - tr, y: minY + tr), radius: tr, startAngle: Angle(degrees: -90), endAngle: Angle(degrees: 0), clockwise: false)
		
		p.addLine(to: CGPoint(x: maxX, y: maxY - br))
		p.addArc(center: CGPoint(x: maxX - br, y: maxY - br), radius: br, startAngle: Angle(degrees: 0), endAngle: Angle(degrees: 90), clockwise: false)
		
		p.addLine(to: CGPoint(x: minX + bl, y: maxY))
		p.addArc(center: CGPoint(x: minX + bl, y: maxY - bl), radius: bl, startAngle: Angle(degrees: 90), endAngle: Angle(degrees: 180), clockwise: false)
		
		p.addLine(to: CGPoint(x: minX, y: minY + tl))
		p.addArc(center: CGPoint(x: minX + tl, y: minY + tl), radius: tl, startAngle: Angle(degrees: 180), endAngle: Angle(degrees: 270), clockwise: false)
		
		p.closeSubpath()
		return p
	}
}
