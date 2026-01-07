import SwiftUI

struct LoadingBackdropView: View {
	
	// ─────────── Section Header ───────────
	private enum Kind: CaseIterable {
		case fabric, morphingContours, metamorphosis, torusKnot
	}
	
	private let kind: Kind
	
	init(kindIndex: Int? = nil) {
		let all = Kind.allCases
		if let idx = kindIndex, idx >= 0, idx < all.count {
			self.kind = all[idx]
		} else {
			self.kind = all.randomElement() ?? .fabric
		}
	}
	
	var body: some View {
		contentView(for: kind)
			.ignoresSafeArea()
	}
	
	@ViewBuilder
	private func contentView(for kind: Kind) -> some View {
		switch kind {
		case .fabric:
			FabricView()
		case .morphingContours:
			MorphingContoursView()
		case .metamorphosis:
			MetamorphosisView()
		case .torusKnot:
			TorusKnotView()
		}
	}
}
