import SwiftUI
import CoreText
import UIKit
import FirebaseAnalytics

struct CardBubble: View {
	let headline: String
	let bodyText: String
	
	@Environment(\.curatorBubbleFallbackEnabled) private var isVoiceHeader: Bool
	
	@State private var isExpanded = false
	@State private var previewAttr: AttributedString?
	@State private var remainderAttr: AttributedString?
	private let haptic = UIImpactFeedbackGenerator(style: .light)
	
	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			markdownText(headline)
				.font(.custom("Didot", size: 16))
				.fixedSize(horizontal: false, vertical: true)
			
			Color.clear
				.frame(height: 0)
				.background(
					GeometryReader { geo in
						Color.clear.onAppear {
							guard previewAttr == nil else { return }
							splitText(maxWidth: geo.size.width)
						}
					}
				)
			
			VStack(alignment: .leading, spacing: 0) {
				if let preview = previewAttr {
					Text(preview)
						.font(.custom("Avenir", size: 14))
						.foregroundColor(.black)
						.lineLimit(3)
						.fixedSize(horizontal: false, vertical: true)
				}
				if isExpanded, let remainder = remainderAttr {
					Text(remainder)
						.font(.custom("Avenir", size: 14))
						.foregroundColor(.black)
						.fixedSize(horizontal: false, vertical: true)
						.transition(.asymmetric(
							insertion: .opacity.animation(.easeInOut(duration: 0.15).delay(0.25)),
							removal: .opacity.animation(.easeInOut(duration: 0.05))
						))
				}
			}
		}
		.padding(12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: 14)
				.fill(Color.white.opacity(0.7))
		)
		.scaleEffect(isExpanded ? 1.02 : 1.0)
		.shadow(
			color: .black.opacity(isExpanded ? 0.2 : 0),
			radius: isExpanded ? 8 : 0,
			x: 0, y: isExpanded ? 4 : 0
		)
		.contentShape(RoundedRectangle(cornerRadius: 14))
		.allowsHitTesting(!isVoiceHeader)
		.onTapGesture {
			guard !isVoiceHeader else { return }
			let willExpand = !isExpanded
			haptic.impactOccurred()
			withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
				isExpanded = willExpand
			}
			var params: [String: Any] = ["screen": "curator" as NSString, "trigger": "tap" as NSString]
			Analytics.logEvent(willExpand ? "card_bubble_expand" : "card_bubble_collapse", parameters: params)
		}
		.onAppear {
			if isVoiceHeader { isExpanded = true }
		}
		.onChange(of: isVoiceHeader) { newVal in
			if newVal { isExpanded = true }
		}
	}
	
	@ViewBuilder
	private func markdownText(_ str: String) -> some View {
		if let attr = try? AttributedString(markdown: str) {
			Text(attr).foregroundColor(.black)
		} else {
			Text(str).foregroundColor(.black)
		}
	}
	
	private func splitText(maxWidth: CGFloat) {
		let fullAttr: AttributedString
		if let parsed = try? AttributedString(markdown: bodyText) {
			fullAttr = parsed
		} else {
			fullAttr = AttributedString(bodyText)
		}
		let nsFull = NSAttributedString(fullAttr)
		let framesetter = CTFramesetterCreateWithAttributedString(nsFull)
		let path = CGMutablePath()
		path.addRect(CGRect(x: 0, y: 0, width: maxWidth, height: .greatestFiniteMagnitude))
		let frame = CTFramesetterCreateFrame(framesetter, CFRangeMake(0, 0), path, nil)
		let lines = CTFrameGetLines(frame) as! [CTLine]
		let count = lines.prefix(3).reduce(0) { $0 + CTLineGetStringRange($1).length }
		let total = nsFull.length
		let previewRange = NSRange(location: 0, length: min(count, total))
		let remainderRange = NSRange(location: previewRange.length, length: total - previewRange.length)
		let previewNS = nsFull.attributedSubstring(from: previewRange)
		let remainderNS = nsFull.attributedSubstring(from: remainderRange)
		previewAttr = try? AttributedString(previewNS)
		remainderAttr = try? AttributedString(remainderNS)
	}
}
