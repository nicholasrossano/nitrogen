import SwiftUI

enum DesignTokens {
	enum Colors {
		// Brand & accents
		static let primary = Color("PrimaryColor")
		static let primaryLegacy = Color("PrimaryColor-Old")
		static let accentPrimary = Color("AccentPrimary")
		static let accentSecondary = Color("AccentSecondary")
		static let accentTertiary = Color("AccentTertiary")

		// Neutrals & surfaces
		static let backgroundPrimary = Color("Background")
		static let backgroundSecondary = Color("Cream")
		static let surface = Color("Beige")
		static let surfaceAlt = Color("Blush")
		static let textPrimary = Color("Brown")
		static let textSecondary = Color("SecondaryColor")

		// Semantic accents
		static let destructive = Color("Burgundy")
		static let success = Color("Forest")
		static let warning = Color("Rust")
		static let info = Color("Teal")
		static let merlot = Color("Merlot")
	}

	enum Spacing {
		static let xxs: CGFloat = 4
		static let xs: CGFloat = 8
		static let sm: CGFloat = 10
		static let md: CGFloat = 12
		static let lg: CGFloat = 16
		static let xl: CGFloat = 20
		static let xxl: CGFloat = 22
		static let xxxl: CGFloat = 24
		static let hero: CGFloat = 32
		static let jumbo: CGFloat = 60
	}

	enum Radius {
		static let xs: CGFloat = 5
		static let sm: CGFloat = 6
		static let md: CGFloat = 8
		static let lg: CGFloat = 10
		static let xl: CGFloat = 14
		static let xxl: CGFloat = 16
		static let card: CGFloat = 20
		static let pill: CGFloat = 18
		static let rounded: CGFloat = 24
		static let softPill: CGFloat = 25
		static let jumbo: CGFloat = 30
		static let capsule: CGFloat = 50
	}

	struct ShadowToken {
		let color: Color
		let radius: CGFloat
		let x: CGFloat
		let y: CGFloat
	}

	enum Shadows {
		static let subtle = ShadowToken(color: Color.black.opacity(0.12), radius: 4, x: 0, y: 2)
		static let lifted = ShadowToken(color: Color.black.opacity(0.2), radius: 6, x: 0, y: 4)
		static let heavy = ShadowToken(color: Color.black.opacity(0.35), radius: 8, x: 0, y: 3)
		static let glowSoft = ShadowToken(color: Color("Beige").opacity(0.15), radius: 14, x: 0, y: 0)
		static let glowStrong = ShadowToken(color: Color("Beige").opacity(0.25), radius: 22, x: 0, y: 0)
	}

	enum Typography {
		// Display
		static let displayXL = Font.system(size: 60)
		static let displayL = Font.system(size: 50)
		static let displayM = Font.custom("Didot-Italic", size: 44)

		// Titles & headings
		static let title = Font.system(size: 32, weight: .semibold)
		static let headline = Font.system(size: 20, weight: .semibold)
		static let headlineSerif = Font.custom("Didot-Bold", size: 20)

		// Body
		static let body = Font.custom("Avenir", size: 16)
		static let bodyMedium = Font.custom("Avenir-Medium", size: 16)
		static let bodySmall = Font.custom("Avenir", size: 15)
		static let caption = Font.custom("Avenir", size: 14)
		static let footnote = Font.system(size: 10, weight: .semibold)
	}
}
