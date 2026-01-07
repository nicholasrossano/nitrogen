import SwiftUI

struct ScrollOffsetReader: UIViewRepresentable {
	let onChange: (_ contentOffsetY: CGFloat, _ insetTop: CGFloat, _ panState: UIGestureRecognizer.State) -> Void
	
	func makeCoordinator() -> Coordinator { Coordinator() }
	
	func makeUIView(context: Context) -> UIView {
		let view = UIView(frame: .zero)
		view.isUserInteractionEnabled = false
		DispatchQueue.main.async {
			guard let scroll = enclosingScrollView(from: view) else { return }
			scroll.alwaysBounceVertical = true
			context.coordinator.scrollView = scroll
			context.coordinator.onChange = onChange
			scroll.addObserver(context.coordinator, forKeyPath: "contentOffset", options: [.new, .initial], context: nil)
			scroll.panGestureRecognizer.addTarget(context.coordinator, action: #selector(Coordinator.handlePan(_:)))
		}
		return view
	}
	
	func updateUIView(_ uiView: UIView, context: Context) {}
	
	static func dismantleUIView(_ uiView: UIView, coordinator: Coordinator) {
		coordinator.teardown()
	}
	
	final class Coordinator: NSObject {
		weak var scrollView: UIScrollView?
		var onChange: ((_ y: CGFloat, _ insetTop: CGFloat, _ state: UIGestureRecognizer.State) -> Void)?
		
		override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey : Any]?, context: UnsafeMutableRawPointer?) {
			guard keyPath == "contentOffset", let scroll = scrollView else { return }
			onChange?(scroll.contentOffset.y, scroll.adjustedContentInset.top, scroll.panGestureRecognizer.state)
		}
		
		@objc func handlePan(_ pan: UIPanGestureRecognizer) {
			guard let scroll = scrollView else { return }
			onChange?(scroll.contentOffset.y, scroll.adjustedContentInset.top, pan.state)
		}
		
		func teardown() {
			if let scroll = scrollView {
				scroll.removeObserver(self, forKeyPath: "contentOffset")
				scroll.panGestureRecognizer.removeTarget(self, action: #selector(handlePan(_:)))
			}
		}
	}
}

private func enclosingScrollView(from view: UIView) -> UIScrollView? {
	var v: UIView? = view
	while let cur = v {
		if let s = cur as? UIScrollView { return s }
		v = cur.superview
	}
	return nil
}
