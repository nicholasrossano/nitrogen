import SwiftUI

struct CustomBackButton: View {
    @Environment(\.dismiss) private var dismiss
    let color: Color?
    let symbol: String

    init(color: Color? = nil, symbol: String = "chevron.left") {
        self.color = color
        self.symbol = symbol
    }

    var body: some View {
        Button(action: {
            dismiss()
        }) {
            Image(systemName: symbol)
                .foregroundColor(color ?? Color.accentSecondary)
                .imageScale(symbol == "xmark" ? .medium : .large)
        }
    }
}

struct CustomNavigationModifier: ViewModifier {
    let title: String
    let trailing: AnyView?
    let showBackButton: Bool
    let titleColor: Color?
    let backButtonColor: Color?
    let backButtonSymbol: String

    @Environment(\.dismiss) private var dismiss

    init(
        title: String,
        trailing: AnyView? = nil,
        showBackButton: Bool = true,
        titleColor: Color? = nil,
        backButtonColor: Color? = nil,
        backButtonSymbol: String = "chevron.left"
    ) {
        self.title = title
        self.trailing = trailing
        self.showBackButton = showBackButton
        self.titleColor = titleColor
        self.backButtonColor = backButtonColor
        self.backButtonSymbol = backButtonSymbol
    }

    func body(content: Content) -> some View {
        content
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
            .navigationBarItems(
                leading: showBackButton ? AnyView(CustomBackButton(color: backButtonColor, symbol: backButtonSymbol)) : AnyView(EmptyView()),
                trailing: trailing
            )
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title)
                        .font(.custom("Avenir-Medium", size: 18))
                        .foregroundColor(titleColor ?? .black)
                }
            }
            .accentColor(Color.accentSecondary)
    }
}

struct NavigationConfigurator: UIViewControllerRepresentable {
    var configure: (UINavigationController) -> Void = { _ in }

    func makeUIViewController(context: Context) -> UIViewController {
        UIViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        if let nc = uiViewController.navigationController {
            nc.delegate = context.coordinator
            configure(nc)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator: NSObject, UINavigationControllerDelegate {
        func navigationController(_ navigationController: UINavigationController,
                                  animationControllerFor operation: UINavigationController.Operation,
                                  from fromVC: UIViewController,
                                  to toVC: UIViewController) -> UIViewControllerAnimatedTransitioning? {
            if operation == .push {
                return SlideInFromRightTransition()
            } else if operation == .pop {
                return SlideInFromLeftTransition()
            }
            return nil
        }
    }
}

class SlideInFromRightTransition: NSObject, UIViewControllerAnimatedTransitioning {
    func transitionDuration(using transitionContext: UIViewControllerContextTransitioning?) -> TimeInterval {
        return 0.3
    }

    func animateTransition(using transitionContext: UIViewControllerContextTransitioning) {
        guard let toView = transitionContext.view(forKey: .to) else { return }

        let container = transitionContext.containerView
        let duration = transitionDuration(using: transitionContext)

        // Start the new view from the right side
        toView.transform = CGAffineTransform(translationX: container.frame.width, y: 0)
        container.addSubview(toView)

        UIView.animate(withDuration: duration, animations: {
            toView.transform = .identity
        }, completion: { finished in
            transitionContext.completeTransition(finished)
        })
    }
}

class SlideInFromLeftTransition: NSObject, UIViewControllerAnimatedTransitioning {
    func transitionDuration(using transitionContext: UIViewControllerContextTransitioning?) -> TimeInterval {
        return 0.3
    }

    func animateTransition(using transitionContext: UIViewControllerContextTransitioning) {
        guard let toView = transitionContext.view(forKey: .to) else { return }

        let container = transitionContext.containerView
        let duration = transitionDuration(using: transitionContext)

        // Start the new view from the left side
        toView.transform = CGAffineTransform(translationX: -container.frame.width, y: 0)
        container.addSubview(toView)

        UIView.animate(withDuration: duration, animations: {
            toView.transform = .identity
        }, completion: { finished in
            transitionContext.completeTransition(finished)
        })
    }
}

extension View {
    func customNavigation(
        title: String,
        trailing: AnyView? = nil,
        showBackButton: Bool = true,
        titleColor: Color? = .primary,
        backButtonColor: Color? = nil,
        backButtonSymbol: String = "chevron.left"
    ) -> some View {
        self.modifier(
            CustomNavigationModifier(
                title: title,
                trailing: trailing,
                showBackButton: showBackButton,
                titleColor: titleColor,
                backButtonColor: backButtonColor,
                backButtonSymbol: backButtonSymbol
            )
        )
    }
}
