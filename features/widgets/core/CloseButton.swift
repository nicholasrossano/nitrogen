import SwiftUI
import UIKit

// ─────────── Press Scale Style ───────────
struct PressScaleStyle: ButtonStyle {
	var pressedScale: CGFloat = 1.25
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.scaleEffect(configuration.isPressed ? pressedScale : 1.0)
			.animation(.easeInOut(duration: 0.12), value: configuration.isPressed)
			.onChange(of: configuration.isPressed) { pressed in
				if pressed {
					UIImpactFeedbackGenerator(style: .light).impactOccurred()
				}
			}
	}
}

// ─────────── Close Button ───────────
struct CloseButton: View {
	var systemName: String = "xmark"
	var size: CGFloat = UIScreen.main.bounds.width * 0.10
	var action: () -> Void
	
	private var imageSize: CGFloat { size * 0.4 }
	
	var body: some View {
		Button(action: action) {
			ZStack {
				Circle()
					.fill(Color.clear)
					.background(
						Group {
							if #available(iOS 26.0, *) {
								Circle().glassEffect()
							} else {
								Circle().fill(.ultraThinMaterial)
							}
						}
					)
					.overlay(
						Group {
							if #available(iOS 26.0, *) {
								EmptyView()
							} else {
								Circle().stroke(Color.white.opacity(0.7), lineWidth: 0.5)
							}
						}
					)
				
				Image(systemName: systemName)
					.font(.system(size: imageSize, weight: .semibold))
					.foregroundColor(.white)
			}
			.frame(width: size, height: size)
			.contentShape(Circle())
		}
		.buttonStyle(PressScaleStyle())
	}
}
