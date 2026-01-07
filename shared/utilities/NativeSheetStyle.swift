import SwiftUI

// ─────────── Native Sheet Style Modifier ───────────
struct NativeSheetStyle: ViewModifier {
	func body(content: Content) -> some View {
		if #available(iOS 17.0, *) {
			content
				.presentationDragIndicator(.visible)
				.presentationBackground(.regularMaterial)
				.presentationCornerRadius(16)
		} else {
			if #available(iOS 16.4, *) {
				content
					.presentationDragIndicator(.visible)
					.presentationBackground(.regularMaterial)
			} else {
				content
					.presentationDragIndicator(.visible)
			}
		}
	}
}

extension View {
	func asNativeSheet() -> some View {
		modifier(NativeSheetStyle())
	}
}
