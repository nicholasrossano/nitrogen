import SwiftUI

// MARK: – PreferenceKey for anchors
private struct TourAnchorKey: PreferenceKey {
	static var defaultValue: [String: Anchor<CGRect>] = [:]
	static func reduce(value: inout [String: Anchor<CGRect>],
					   nextValue: () -> [String: Anchor<CGRect>]) {
		value.merge(nextValue(), uniquingKeysWith: { $1 })
	}
}

// MARK: – Modifier
extension View {
	/// Tags a view as a target for an onboarding step.
	func tourTag(_ id: String) -> some View {
		anchorPreference(key: TourAnchorKey.self, value: .bounds) { anchor in
			[id: anchor]
		}
	}
}

// MARK: – Reader
struct TourAnchorReader<Content: View>: View {
	@EnvironmentObject private var manager: OnboardingManager
	let content: Content
	
	init(@ViewBuilder content: () -> Content) { self.content = content() }
	
	var body: some View {
		content
			.onPreferenceChange(TourAnchorKey.self) { prefs in
				manager.anchors.merge(prefs, uniquingKeysWith: { $1 })
			}
	}
}
