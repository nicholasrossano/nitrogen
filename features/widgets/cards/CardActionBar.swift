import SwiftUI

struct CardActionBar: View {
	let label: String?
	let onTap: (() -> Void)?
	let onIconTap: (() -> Void)?
	
	// ─────────── Section Header ───────────
	private let screenWidth = UIScreen.main.bounds.width
	private var hPad: CGFloat { screenWidth * 0.03 }
	private var vPad: CGFloat { screenWidth * 0.022 }
	private var fontSize: CGFloat { screenWidth * 0.034 }
	private let cornerRadius: CGFloat = 10
	
	init(label: String?, onTap: (() -> Void)? = nil, onIconTap: (() -> Void)? = nil) {
		self.label = label
		self.onTap = onTap
		self.onIconTap = onIconTap
	}
	
	var body: some View {
		Group {
			if let text = label, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				HStack(spacing: 12) {
					Text(text)
						.font(.custom("Avenir", size: fontSize).weight(.medium))
						.foregroundColor(.black)
						.lineLimit(2)
						.multilineTextAlignment(.leading)
						.truncationMode(.tail)
						.fixedSize(horizontal: false, vertical: true)
					
					Spacer(minLength: 8)
					
					Image(systemName: "arrow.right.circle.fill")
						.font(.system(size: 20, weight: .semibold))
						.foregroundColor(Color("Brown"))
						.frame(width: 28, height: 28, alignment: .center)
						.contentShape(Rectangle())
						.onTapGesture { onIconTap?() }
				}
				.padding(.horizontal, hPad)
				.padding(.vertical,   vPad)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(Color.white.opacity(0.5))
				.clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
				.shadow(color: Color.black.opacity(0.2), radius: 6, x: 0, y: 4)
				.contentShape(Rectangle())
				.onTapGesture { onTap?() }
			} else {
				EmptyView()
			}
		}
	}
}
