import Combine
import Foundation
import UIKit

enum VisibilityMode {
	case normal
	case expandedCard
	case curatorMode
	case zoomedArtwork
	case topicsGrid
}

enum AppWidget {
	case profileButton
	case audioButton
	case curatorButton
	case favoriteButton
	case gridButton
	case topicTitle
	case topicDescription
	case swipeableStack
	case widgetStack
	case sourceBoxContainer
	case actionBar
	case curatorView
	case emptyStackIcon
}

class VisibilityNotifier: ObservableObject {
	@Published var mode: VisibilityMode = .normal
	var priorMode: VisibilityMode = .normal
	
	func isWidgetVisible(_ widget: AppWidget) -> Bool {
		switch mode {
		case .normal:
			return true
			
		case .expandedCard:
			switch widget {
			case .profileButton,
					.audioButton,
					.curatorButton,
					.favoriteButton,
					.gridButton,
					.topicTitle,
					.topicDescription,
					.emptyStackIcon:
				return false
				
			case .swipeableStack,
					.widgetStack,
					.sourceBoxContainer,
					.actionBar,
					.curatorView:
				return true
			}
			
		case .curatorMode:
			switch widget {
			case .curatorView:
				return true
			default:
				return false
			}
			
		case .zoomedArtwork:
			switch widget {
			case .widgetStack:
				return true
			default:
				return false
			}
			
		case .topicsGrid:
			return false
		}
	}
	
	// ─────────── Section Header ───────────
	// Single toggle for the shared backdrop blur used by expanded-card and Curator states
	var isBackdropVisible: Bool {
		switch mode {
		case .expandedCard, .curatorMode:
			return true
		default:
			return false
		}
	}
	
	// ─────────── Section Header ───────────
	// Shared backdrop blur style/intensity (authoritative)
	var backdropStyle: UIBlurEffect.Style {
		switch mode {
		case .expandedCard: return .systemUltraThinMaterial
		case .curatorMode:  return .systemMaterial
		default:            return .systemMaterial
		}
	}
	
	var backdropIntensity: CGFloat {
		switch mode {
		case .expandedCard: return 0.0
		case .curatorMode:  return 0.15
		default:            return 0.0
		}
	}
}
