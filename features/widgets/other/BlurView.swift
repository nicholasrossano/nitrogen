import SwiftUI
import UIKit

// ─────────── BlurView (Liquid Glass on iOS 26 SDK builds; UIKit blur otherwise) ───────────

struct BlurView: View {
	var style: UIBlurEffect.Style
	var intensity: CGFloat = 1
	var gradientColors: [UIColor]? = nil
	
	var body: some View {
		Group {
#if LIQUID_GLASS_AVAILABLE
			if #available(iOS 26.0, *) {
				ZStack {
					if let colors = gradientColors, colors.count >= 2 {
						LinearGradient(
							colors: colors.map { Color(uiColor: $0) },
							startPoint: .topLeading,
							endPoint: .bottomTrailing
						)
					}
					Rectangle()
						.fill(.clear)
						.glassBackgroundEffect(in: Rectangle())
					Rectangle()
						.fill(Color.black.opacity(Self.clamp01(intensity)))
				}
			} else {
				_UIKitBlur(style: style, intensity: intensity, gradientColors: gradientColors)
			}
#else
			_UIKitBlur(style: style, intensity: intensity, gradientColors: gradientColors)
#endif
		}
		.accessibilityHidden(true)
	}
	
	private static func clamp01(_ v: CGFloat) -> CGFloat { max(0, min(1, v)) }
}

// ─────────── UIKit Blur Fallback (matches your existing behavior) ───────────

private struct _UIKitBlur: UIViewRepresentable {
	var style: UIBlurEffect.Style
	var intensity: CGFloat = 1
	var gradientColors: [UIColor]? = nil
	
	func makeUIView(context: Context) -> UIView {
		let container = UIView()
		container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
		
		if let colors = gradientColors, colors.count >= 2 {
			let grad = CAGradientLayer()
			grad.colors     = colors.map { $0.cgColor }
			grad.startPoint = CGPoint(x: 0, y: 0)
			grad.endPoint   = CGPoint(x: 1, y: 1)
			grad.frame      = container.bounds
			container.layer.insertSublayer(grad, at: 0)
		}
		
		let blurEffect  = UIBlurEffect(style: style)
		let blurView    = UIVisualEffectView(effect: blurEffect)
		blurView.frame  = container.bounds
		blurView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
		
		let dimming = UIView(frame: blurView.bounds)
		dimming.backgroundColor = UIColor(white: 0, alpha: Self.clamp01(intensity))
		dimming.autoresizingMask = [.flexibleWidth, .flexibleHeight]
		blurView.contentView.addSubview(dimming)
		
		container.addSubview(blurView)
		return container
	}
	
	func updateUIView(_ uiView: UIView, context: Context) {
		if let colors = gradientColors, colors.count >= 2 {
			if let grad = uiView.layer.sublayers?.first(where: { $0 is CAGradientLayer }) as? CAGradientLayer {
				grad.colors = colors.map { $0.cgColor }
				grad.frame  = uiView.bounds
			} else {
				let grad = CAGradientLayer()
				grad.colors     = colors.map { $0.cgColor }
				grad.startPoint = CGPoint(x: 0, y: 0)
				grad.endPoint   = CGPoint(x: 1, y: 1)
				grad.frame      = uiView.bounds
				uiView.layer.insertSublayer(grad, at: 0)
			}
		} else {
			uiView.layer.sublayers?
				.filter { $0 is CAGradientLayer }
				.forEach { $0.removeFromSuperlayer() }
		}
		
		for sub in uiView.subviews {
			guard let blurView = sub as? UIVisualEffectView else { continue }
			blurView.frame = uiView.bounds
			for dim in blurView.contentView.subviews {
				dim.frame = blurView.bounds
				dim.backgroundColor = UIColor(white: 0, alpha: Self.clamp01(intensity))
			}
		}
	}
	
	private static func clamp01(_ v: CGFloat) -> CGFloat { max(0, min(1, v)) }
}
