import SwiftUI

struct CuratorToolbar: View {
	let canCopy: Bool
	let isThumbsUp: Bool
	let isThumbsDown: Bool
	let onCopy: () -> Void
	let onThumbsUp: () -> Void
	let onThumbsDown: () -> Void
	let onRefresh: () -> Void
	
	@State private var didCopy = false
	@State private var copyStateID = 0
	
	var body: some View {
		HStack(spacing: 20) {
			Button {
				guard canCopy else { return }
				onCopy()
				
				withAnimation(.easeInOut(duration: 0.1)) { didCopy = true }
				copyStateID += 1
				let current = copyStateID
				DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
					if current == copyStateID {
						withAnimation(.easeInOut(duration: 0.3)) { didCopy = false }
					}
				}
			} label: {
				Image(systemName: didCopy ? "checkmark" : "square.on.square")
					.font(.system(size: 14))
					.foregroundColor(canCopy ? .secondary : Color(.darkGray))
					.contentTransition(.opacity)
			}
			.buttonStyle(.plain)
			.disabled(!canCopy)
			
			if !isThumbsDown {
				Button {
					onThumbsUp()
				} label: {
					Image(systemName: isThumbsUp ? "hand.thumbsup.fill" : "hand.thumbsup")
						.font(.system(size: 14))
						.foregroundColor(.secondary)
						.contentTransition(.opacity)
				}
				.buttonStyle(.plain)
			}
			
			if !isThumbsUp {
				Button {
					onThumbsDown()
				} label: {
					Image(systemName: isThumbsDown ? "hand.thumbsdown.fill" : "hand.thumbsdown")
						.font(.system(size: 14))
						.foregroundColor(.secondary)
						.contentTransition(.opacity)
				}
				.buttonStyle(.plain)
			}
			
			Button {
				onRefresh()
			} label: {
				Image(systemName: "arrow.clockwise")
					.font(.system(size: 14))
					.foregroundColor(.secondary)
					.contentTransition(.opacity)
			}
			.buttonStyle(.plain)
		}
		.animation(.easeInOut(duration: 0.3), value: isThumbsUp)
		.animation(.easeInOut(duration: 0.3), value: isThumbsDown)
		.background(InteractiveFrameReader())
	}
}
