import SwiftUI

struct DomainPill: View {
	let title: String
	let isSelected: Bool
	let onTap: () -> Void
	
	// ─────────── Section Header ───────────
	private var bgFill: Color {
		isSelected ? Color.white.opacity(0.18) : Color.white.opacity(0.10)
	}
	private var stroke: Color {
		isSelected ? Color.white : Color.white.opacity(0.18)
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
				.background(
					RoundedRectangle(cornerRadius: 18, style: .continuous)
						.fill(bgFill)
				)
				.overlay(
					RoundedRectangle(cornerRadius: 18, style: .continuous)
						.stroke(stroke, lineWidth: isSelected ? 1.5 : 1)
				)
				.compositingGroup()
				.shadow(color: Color.white.opacity(0.10), radius: 1, x: 0, y: -1)
				.shadow(color: Color.black.opacity(0.30), radius: 10, x: 0, y: 8)
				.foregroundColor(.white)
		}
		.buttonStyle(.plain)
		.contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
	}
}
