import SwiftUI

struct CuratorSuggestionItem: View {
	let label: String?
	let centered: Bool
	let onTap: (() -> Void)?
	
	// ─────────── Section Header ───────────
	private let screenWidth = UIScreen.main.bounds.width
	private var hPad: CGFloat { screenWidth * 0.03 }
	private var vPad: CGFloat { screenWidth * 0.024 }
	private var fontSize: CGFloat { screenWidth * 0.035 }
	
	init(label: String?, centered: Bool = false, onTap: (() -> Void)? = nil) {
		self.label = label
		self.centered = centered
		self.onTap = onTap
	}

	private func sanitizedLabel(_ text: String) -> String {
		let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
		if let attributed = try? AttributedString(markdown: text, options: options) {
			return String(attributed.characters)
		}
		return text
	}
	
	var body: some View {
		Group {
			if let text = label, !text.isEmpty {
				Text(sanitizedLabel(text))
					.dynamicTypeSize(.medium ... .medium)
					.font(.custom("Avenir", size: fontSize).weight(.medium))
					.foregroundColor(.black)
					.lineLimit(2)
					.multilineTextAlignment(centered ? .center : .leading)
					.truncationMode(.tail)
					.fixedSize(horizontal: false, vertical: true)
					.padding(.horizontal, hPad)
					.padding(.vertical,   vPad)
					.background(Color.white.opacity(0.5))
					.clipShape(Capsule())
					.shadow(color: Color.black.opacity(0.2), radius: 6, x: 0, y: 4)
					.frame(maxWidth: screenWidth - 32, alignment: centered ? .center : .leading)
					.contentShape(Rectangle())
					.transaction { $0.disablesAnimations = true }
					.onTapGesture { onTap?() }
			} else {
				EmptyView()
			}
		}
	}
}
