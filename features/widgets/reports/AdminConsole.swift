// AdminConsole.swift

import SwiftUI
import Combine
import FirebaseFirestore
import FirebaseAnalytics
import UIKit

private struct AdminConsoleFormHeightKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct AdminConsole: View {
	@Binding var isPresented: Bool
	let cardId: String
	var onHeightChange: ((CGFloat) -> Void)? = nil
	let card: Card?
	
	@State private var selectedReason: String?
	@State private var comment: String = ""
	
	private let reasons: [(id: String, title: String)] = [
		(id: "inaccurate_or_low_quality", title: "Reject card"),
		(id: "topic_misclassification",   title: "Recategorize"),
		(id: "widget_irrelevant",         title: "Disable widget"),
		(id: "toggle_spoiler",            title: "Toggle spoiler"),
		(id: "fix_request",               title: "Request fix"),
		(id: "style_note",                title: "Style note")
	]
	
	@EnvironmentObject var servicesLocator: AppServicesLocator
	@State private var cancellables = Set<AnyCancellable>()
	
	// ─────────── Admin-only metadata state ───────────
	@State private var topicName: String?
	@State private var topicIdInternal: String?
	@State private var coreEntityType: String?
	@State private var isAdmin: Bool = false
	
	// ─────────── Dynamic sizing state ───────────
	@State private var formHeight: CGFloat = 0
	
	// ─────────── Keyboard state ───────────
	@State private var isKeyboardVisible: Bool = false
	
	// ─────────── Comment UI sizing ───────────
	private let commentBoxHeight: CGFloat = 50
	
	var body: some View {
		VStack(spacing: 0) {
			VStack(alignment: .leading, spacing: 8) {
				Text("Editor Console")
					.font(.headline)
					.frame(maxWidth: .infinity, alignment: .center)
					.padding(.horizontal)
					.padding(.top, 30)
				
				if let card {
					let fullJson = cardJsonFull(for: card)
					let displayJson = cardJsonDisplay(from: fullJson)
					
					CardMetadataBubble(
						displayJsonText: displayJson,
						fullJsonText: fullJson,
						cardId: cardId,
						topicId: topicIdInternal,
						isCompact: isKeyboardVisible
					)
				}
			}
			
			ScrollView {
				VStack(alignment: .leading, spacing: 16) {
					ReasonOptionFlowLayout(horizontalSpacing: 10, verticalSpacing: 10) {
						ForEach(reasons, id: \.id) { reason in
							ReasonOptionRect(
								title: reason.title,
								isSelected: selectedReason == reason.id
							) {
								let generator = UIImpactFeedbackGenerator(style: .light)
								generator.prepare()
								generator.impactOccurred()
								
								if selectedReason == reason.id {
									selectedReason = nil
								} else {
									selectedReason = reason.id
								}
								
								Analytics.logEvent(
									"admin_console_reason_tap",
									parameters: [
										"screen": "admin_console" as NSString,
										"card_id": cardId as NSString,
										"reason_id": reason.id as NSString
									]
								)
							}
						}
					}
					.frame(maxWidth: .infinity, alignment: .leading)
					
					HStack(spacing: 10) {
						TextField("Add a comment", text: $comment)
							.padding(.horizontal, 16)
							.frame(height: commentBoxHeight)
							.frame(maxWidth: .infinity)
							.background(Color(.systemGray6))
							.cornerRadius(commentBoxHeight / 2)
						
						let submitSide = commentBoxHeight / 2
						let isSubmitEnabled = (selectedReason != nil)
						
						Button {
							let generator = UIImpactFeedbackGenerator(
								style: .medium
							)
							generator.prepare()
							generator.impactOccurred()
							
							Analytics.logEvent(
								"admin_console_submit_tap",
								parameters: [
									"screen": "admin_console" as NSString,
									"card_id": cardId as NSString,
									"topic_id": (topicIdInternal ?? "") as NSString,
									"reason_id": (selectedReason ?? "") as NSString
								]
							)
							
							if selectedReason == "toggle_spoiler" {
								Analytics.logEvent(
									"admin_console_toggle_spoiler_submit",
									parameters: [
										"screen": "admin_console" as NSString,
										"card_id": cardId as NSString,
										"topic_id": (topicIdInternal ?? "") as NSString,
										"trigger": "submit" as NSString
									]
								)
							}
							
							submitReport()
							isPresented = false
						} label: {
							Image(systemName: "arrow.right.circle.fill")
								.font(.system(size: submitSide, weight: .semibold))
								.foregroundColor(isSubmitEnabled ? .accentPrimary : Color(.systemGray3))
								.opacity(isSubmitEnabled ? 1.0 : 0.6)
								.frame(width: submitSide, height: submitSide)
								.contentShape(Rectangle())
						}
						.buttonStyle(.plain)
						.disabled(!isSubmitEnabled)
						.accessibilityLabel("Submit")
					}
				}
				.padding(.horizontal)
				.padding(.top, 24)
				.padding(.bottom, 24)
				.background(
					GeometryReader { proxy in
						Color.clear
							.preference(key: AdminConsoleFormHeightKey.self, value: proxy.size.height)
					}
				)
			}
			.environment(\.sizeCategory, .medium)
			.onAppear {
				isAdmin = (FeatureFlagsManager.shared.currentUserRole == "admin")
				loadMetadata()
				Analytics.logEvent(
					"admin_console_view",
					parameters: [
						"screen": "admin_console" as NSString,
						"card_id": cardId as NSString
					]
				)
			}
		}
		.onPreferenceChange(AdminConsoleFormHeightKey.self) { h in
			formHeight = h
			notifyHeight()
		}
		.onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
			guard
				let info = notification.userInfo,
				let frameEnd = info[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
			else { return }
			
			let screenHeight = UIScreen.main.bounds.height
			let visible = frameEnd.origin.y < screenHeight
			
			withAnimation(.easeOut(duration: 0.25)) {
				isKeyboardVisible = visible
			}
		}
		.ignoresSafeArea(.container, edges: .bottom)
		.asNativeSheet()
	}
	
	// ─────────── Section Title ───────────
	private func notifyHeight() {
		let screenH = UIScreen.main.bounds.height
		let desired = formHeight + 24
		let fraction = max(0.30, min(0.82, desired / max(1, screenH)))
		onHeightChange?(fraction)
	}
	
	// ─────────── Section Title ───────────
	private func submitReport() {
		guard let reasonId = selectedReason else { return }
		guard servicesLocator.userService.getUserId() != nil else { return }
		
		servicesLocator.reportService.submitReport(
			cardId: cardId,
			reasonId: reasonId,
			comment: comment
		)
		.sink(receiveCompletion: { _ in }, receiveValue: {})
		.store(in: &cancellables)
	}
	
	// ─────────── Section Title ───────────
	private func loadMetadata() {
		let db = Firestore.firestore()
		
		db.collection("cards").document(cardId).getDocument { doc, _ in
			guard let data = doc?.data() else { return }
			
			let topicId = data["topic"] as? String
			self.topicIdInternal = topicId
			
			if let enriched = data["enrichedMetadata"] as? [String: Any],
			   let core = enriched["coreEntity"] as? [String: Any],
			   let type = core["type"] as? String {
				self.coreEntityType = type
			}
			
			guard let topicId = topicId, !topicId.isEmpty else { return }
			
			db.collection("topics").document(topicId).getDocument { topicDoc, _ in
				let td = topicDoc?.data() ?? [:]
				let name = (td["name"] as? String) ?? (td["topic"] as? String)
				if let n = name, !n.isEmpty {
					self.topicName = n
				}
			}
		}
	}
	
	private func cardJsonFull(for card: Card) -> String {
		let encoder = JSONEncoder()
		encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
		encoder.dateEncodingStrategy = .iso8601
		
		if let data = try? encoder.encode(card),
		   let str = String(data: data, encoding: .utf8) {
			return str
		}
		return "{}"
	}
	
	private func cardJsonDisplay(from fullJson: String) -> String {
		guard let data = fullJson.data(using: .utf8) else { return fullJson }
		guard var obj = (try? JSONSerialization.jsonObject(with: data, options: [])) as? [String: Any] else { return fullJson }
		
		let keysToHide: [String] = [
			"headline",
			"body",
			
			"id",
			"cardId",
			"card_id",
			
			"topic",
			"topicId",
			"topic_id",
			
			"status",
			"approvalStatus",
			"approval_status",
			"moderationStatus",
			"moderation_status",
			
			"reasonCode",
			"reason_code",
			"rejectionReason",
			"rejection_reason",
			"rejectionCode",
			"rejection_code"
		]
		
		for key in keysToHide {
			obj.removeValue(forKey: key)
		}
		
		if let filteredData = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
		   let filteredString = String(data: filteredData, encoding: .utf8) {
			return filteredString
		}
		
		return fullJson
	}
}

// ─────────── Reason option rects ───────────

private struct ReasonOptionRect: View {
	let title: String
	let isSelected: Bool
	let onTap: () -> Void
	
	@Environment(\.colorScheme) private var colorScheme
	
	private var bgFill: Color {
		if colorScheme == .dark {
			return Color.white.opacity(0.10)
		}
		return isSelected ? Color.accentPrimary.opacity(0.12) : Color(.systemGray6)
	}
	
	private var stroke: Color {
		if colorScheme == .dark {
			return isSelected ? Color.accentPrimary : Color.white.opacity(0.18)
		}
		return isSelected ? Color.accentPrimary : Color(.separator).opacity(0.35)
	}
	
	private var foreground: Color {
		if colorScheme == .dark {
			return isSelected ? Color.accentPrimary : Color.white
		}
		return isSelected ? Color.accentPrimary : Color.primary
	}
	
	var body: some View {
		Button(action: onTap) {
			Text(title)
				.font(.system(size: 14, weight: .semibold))
				.lineLimit(1)
				.minimumScaleFactor(0.85)
				.padding(.horizontal, 12)
				.padding(.vertical, 8)
				.frame(minHeight: 32)
				.fixedSize(horizontal: true, vertical: false)
				.background(
					RoundedRectangle(cornerRadius: 10, style: .continuous)
						.fill(bgFill)
				)
				.overlay(
					RoundedRectangle(cornerRadius: 10, style: .continuous)
						.stroke(stroke, lineWidth: isSelected ? 1.5 : 1)
				)
				.foregroundColor(foreground)
		}
		.buttonStyle(.plain)
		.contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
	}
}

private struct ReasonOptionFlowLayout: Layout {
	var horizontalSpacing: CGFloat
	var verticalSpacing: CGFloat
	
	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		let maxWidth = proposal.width ?? UIScreen.main.bounds.width * 0.8
		guard maxWidth > 0 else { return .zero }
		
		var x: CGFloat = 0
		var y: CGFloat = 0
		var rowHeight: CGFloat = 0
		
		for subview in subviews {
			let size = subview.sizeThatFits(.unspecified)
			
			if x + size.width > maxWidth, x > 0 {
				x = 0
				y += rowHeight + verticalSpacing
				rowHeight = 0
			}
			
			rowHeight = max(rowHeight, size.height)
			x += size.width + horizontalSpacing
		}
		
		y += rowHeight
		return CGSize(width: maxWidth, height: y)
	}
	
	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
		let maxWidth = bounds.width
		var x = bounds.minX
		var y = bounds.minY
		var rowHeight: CGFloat = 0
		
		for subview in subviews {
			let size = subview.sizeThatFits(.unspecified)
			
			if x + size.width > bounds.minX + maxWidth, x > bounds.minX {
				x = bounds.minX
				y += rowHeight + verticalSpacing
				rowHeight = 0
			}
			
			subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
			rowHeight = max(rowHeight, size.height)
			x += size.width + horizontalSpacing
		}
	}
}

// ─────────── Card metadata bubble ───────────

private struct CardMetadataBubble: View {
	let displayJsonText: String
	let fullJsonText: String
	let cardId: String
	let topicId: String?
	let isCompact: Bool
	
	@Environment(\.colorScheme) private var colorScheme
	
	@State private var didCopyCardId = false
	@State private var cardIdCopyStateID = 0
	
	@State private var didCopyMetadata = false
	@State private var metadataCopyStateID = 0
	
	private let haptic = UIImpactFeedbackGenerator(style: .light)
	
	init(displayJsonText: String, fullJsonText: String, cardId: String, topicId: String? = nil, isCompact: Bool = false) {
		self.displayJsonText = displayJsonText
		self.fullJsonText = fullJsonText
		self.cardId = cardId
		self.topicId = topicId
		self.isCompact = isCompact
	}
	
	private var lines: [String] {
		displayJsonText.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
	}
	
	private var controlHeight: CGFloat { 32 }
	private var controlCorner: CGFloat { 12 }
	private var controlsTopPad: CGFloat { controlHeight + 12 }
	
	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			ScrollView(.vertical, showsIndicators: true) {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(lines.indices, id: \.self) { index in
						highlightedText(for: lines[index])
					}
				}
				.padding(.top, controlsTopPad)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.frame(height: isCompact ? 150 : 350)
		}
		.padding(.horizontal, 12)
		.background(
			RoundedRectangle(cornerRadius: 30)
				.fill(Color(.systemGray6))
		)
		.overlay(
			RoundedRectangle(cornerRadius: 30)
				.stroke(Color.accentSecondary.opacity(0.3), lineWidth: 0.5)
		)
		.overlay(alignment: .topLeading) {
			cardIdCopyButton
				.padding(.top, 10)
				.padding(.leading, 12)
		}
		.overlay(alignment: .topTrailing) {
			metadataCopyButton
				.padding(.top, 10)
				.padding(.trailing, 12)
		}
		.padding(.horizontal)
		.padding(.top, 20)
		.font(.system(.footnote, design: .monospaced))
		.onAppear {
			haptic.prepare()
		}
	}
	
	private var controlStroke: Color {
		Color(.separator).opacity(colorScheme == .dark ? 0.55 : 0.35)
	}
	
	private var controlForeground: Color {
		Color.primary.opacity(0.82)
	}
	
	private var cardIdCopyButton: some View {
		Button {
			guard !cardId.isEmpty else { return }
			haptic.impactOccurred()
			
			Analytics.logEvent(
				"admin_console_copy_card_id_tap",
				parameters: [
					"screen": "admin_console" as NSString,
					"card_id": cardId as NSString,
					"topic_id": (topicId ?? "") as NSString,
					"trigger": "metadata_bubble" as NSString
				]
			)
			
			UIPasteboard.general.string = cardId
			
			withAnimation(.easeInOut(duration: 0.1)) { didCopyCardId = true }
			cardIdCopyStateID += 1
			let current = cardIdCopyStateID
			DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
				if current == cardIdCopyStateID {
					withAnimation(.easeInOut(duration: 0.3)) { didCopyCardId = false }
				}
			}
		} label: {
			HStack(spacing: 6) {
				if didCopyCardId {
					Image(systemName: "checkmark")
						.font(.system(size: 12, weight: .semibold))
						.frame(width: 16, height: 16)
					Text("Copied")
						.font(.system(size: 12, weight: .semibold))
				} else {
					Text("Card ID")
						.font(.system(size: 12, weight: .semibold))
				}
			}
			.foregroundColor(controlForeground)
			.padding(.horizontal, 10)
			.frame(height: controlHeight)
			.background(
				RoundedRectangle(cornerRadius: controlCorner, style: .continuous)
					.fill(.thinMaterial)
			)
			.overlay(
				RoundedRectangle(cornerRadius: controlCorner, style: .continuous)
					.stroke(controlStroke, lineWidth: 0.5)
			)
			.contentTransition(.opacity)
		}
		.buttonStyle(.plain)
		.disabled(cardId.isEmpty)
	}
	
	private var metadataCopyButton: some View {
		Button {
			guard !fullJsonText.isEmpty else { return }
			haptic.impactOccurred()
			
			Analytics.logEvent(
				"admin_console_copy_metadata_json_tap",
				parameters: [
					"screen": "admin_console" as NSString,
					"card_id": cardId as NSString,
					"topic_id": (topicId ?? "") as NSString,
					"trigger": "metadata_bubble" as NSString
				]
			)
			
			UIPasteboard.general.string = fullJsonText
			
			withAnimation(.easeInOut(duration: 0.1)) { didCopyMetadata = true }
			metadataCopyStateID += 1
			let current = metadataCopyStateID
			DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
				if current == metadataCopyStateID {
					withAnimation(.easeInOut(duration: 0.3)) { didCopyMetadata = false }
				}
			}
		} label: {
			Image(systemName: didCopyMetadata ? "checkmark" : "square.on.square")
				.font(.system(size: 14))
				.foregroundColor(controlForeground)
				.frame(width: 16, height: 16)
				.frame(width: controlHeight, height: controlHeight)
				.background(
					RoundedRectangle(cornerRadius: controlCorner, style: .continuous)
						.fill(.thinMaterial)
				)
				.overlay(
					RoundedRectangle(cornerRadius: controlCorner, style: .continuous)
						.stroke(controlStroke, lineWidth: 0.5)
				)
				.contentTransition(.opacity)
		}
		.buttonStyle(.plain)
		.disabled(fullJsonText.isEmpty)
	}
	
	private func highlightedText(for line: String) -> Text {
		var attributed = AttributedString(line)
		
		if let keyRangeInString = line.range(of: #"\".*?\"(?=\s*:)"#, options: .regularExpression) {
			let keyString = String(line[keyRangeInString])
			if let attrRange = attributed.range(of: keyString) {
				attributed[attrRange].foregroundColor = .accentPrimary
			}
		}
		
		let urlPattern = #"https?:\\/\\/[^"\s]+|https?://[^"\s]+"#
		if let regex = try? NSRegularExpression(pattern: urlPattern, options: []) {
			let nsFullRange = NSRange(line.startIndex..<line.endIndex, in: line)
			
			regex.enumerateMatches(in: line, options: [], range: nsFullRange) { match, _, _ in
				guard let match = match,
					  let rangeInString = Range(match.range, in: line) else { return }
				
				let raw = String(line[rangeInString])
				let urlString = raw.replacingOccurrences(
					of: #"\\/"#,
					with: "/",
					options: .regularExpression
				)
				
				guard let url = URL(string: urlString) else { return }
				
				if let attrRange = attributed.range(of: raw) {
					let blush = Color("AccentTertiary")
					attributed[attrRange].foregroundColor = blush
					attributed[attrRange].link = url
				}
			}
		}
		
		return Text(attributed)
	}
}
