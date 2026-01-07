import SwiftUI

struct EmptyStackIcon: View {
	var body: some View {
		ZStack {
			Circle()
				.fill(.ultraThinMaterial)
			Circle()
				.fill(Color.primary.opacity(0.1))
			Image(systemName: "checkmark")
				.resizable()
				.aspectRatio(contentMode: .fit)
				.frame(width: 20, height: 20)
				.foregroundColor(.white)
		}
		.frame(width: 50, height: 50)
	}
}
