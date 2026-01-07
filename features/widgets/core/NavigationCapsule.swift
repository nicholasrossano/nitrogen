// NavigationCapsule.swift

import SwiftUI
import UIKit

struct NavigationCapsule: View {
	@Binding var showDomainGrid: Bool
	var onProfileToggle: () -> Void
	var isCardExpanded: Bool = false
	var height: CGFloat? = nil
	
	@EnvironmentObject private var homeViewModel: HomeViewModel
	
	private var horizontalPad: CGFloat { 8 }
	private var iconSpacing: CGFloat { 6 }
	
	var body: some View {
		let desiredHeight = height ?? 40
		let tapSide = max(desiredHeight - 8, 24)
		let iconSide = min(tapSide, 32)
		let icon = iconSide * 0.50
		
		HStack(spacing: iconSpacing) {
			ProfileButton(side: iconSide, action: onProfileToggle)
				.environmentObject(homeViewModel)
				.frame(width: tapSide, height: tapSide)
			
			if showDomainGrid {
				Button {
					UIImpactFeedbackGenerator(style: .light).impactOccurred()
					showDomainGrid = false
				} label: {
					Image(systemName: "rectangle.portrait.on.rectangle.portrait.angled.fill")
						.font(.system(size: icon, weight: .semibold))
						.foregroundStyle(.white)
						.frame(width: tapSide, height: tapSide)
				}
				.buttonStyle(.plain)
				.accessibilityLabel("Cards")
			} else {
				Button {
					UIImpactFeedbackGenerator(style: .light).impactOccurred()
					showDomainGrid = true
				} label: {
					Image(systemName: "square.grid.2x2.fill")
						.font(.system(size: icon, weight: .semibold))
						.foregroundStyle(.white)
						.frame(width: tapSide, height: tapSide)
				}
				.buttonStyle(.plain)
				.accessibilityLabel("Explore")
			}
		}
		.padding(.horizontal, horizontalPad)
		.frame(height: desiredHeight)
		.background(
			Group {
				if #available(iOS 26.0, *) {
					RoundedRectangle(cornerRadius: 50).glassEffect()
				} else {
					RoundedRectangle(cornerRadius: 50).fill(.ultraThinMaterial)
				}
			}
		)
		.overlay(
			Group {
				if #available(iOS 26.0, *) {
					EmptyView()
				} else {
					RoundedRectangle(cornerRadius: 50)
						.stroke(Color.white.opacity(0.7), lineWidth: 0.5)
				}
			}
		)
		.compositingGroup()
	}
}
