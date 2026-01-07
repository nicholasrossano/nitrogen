import SwiftUI

struct TopDragHandle: View {
	let onDismiss: () -> Void
	@Binding var animProgress: CGFloat
	@State private var dragOffset: CGFloat = 0
	@State private var hasTriggered = false
	
	var body: some View {
		let shrink = max(0.4, 1 - 0.6 * animProgress)
		let opacity = max(0, 1 - animProgress * 3)
		
		Capsule()
			.fill(Color.secondary)
			.frame(width: 36, height: 5)
			.scaleEffect(x: shrink, y: 1, anchor: .center)
			.opacity(opacity)
			.contentShape(Rectangle().inset(by: -22))
			.offset(y: dragOffset)
			.highPriorityGesture(
				DragGesture(minimumDistance: 5)
					.onChanged { value in
						guard !hasTriggered else { return }
						dragOffset   = max(value.translation.height, 0)
						animProgress = min(dragOffset / 120, 1)
						if dragOffset > 40 {
							hasTriggered = true
							onDismiss()
						}
					}
					.onEnded { _ in
						if !hasTriggered {
							withAnimation(.spring(response: 0.35,
												  dampingFraction: 0.8)) {
								dragOffset   = 0
								animProgress = 0
							}
						}
					}
			)
			.accessibilityLabel("Dismiss")
	}
}
