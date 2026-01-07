import SwiftUI

struct InteractiveFrameKey: PreferenceKey {
	static var defaultValue: [CGRect] = []
	static func reduce(value: inout [CGRect], nextValue: () -> [CGRect]) {
		value.append(contentsOf: nextValue())
	}
}

struct InteractiveFrameReader: View {
	var body: some View {
		GeometryReader { geo in
			Color.clear.preference(key: InteractiveFrameKey.self,
								   value: [geo.frame(in: .named("root"))])
		}
	}
}

struct ScrollOffsetKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
		value = nextValue()
	}
}
