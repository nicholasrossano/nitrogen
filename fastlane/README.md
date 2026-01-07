fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios emulate

```sh
[bundle exec] fastlane ios emulate
```

Run Firebase emulators and pop their UI in the default browser

### ios functions

```sh
[bundle exec] fastlane ios functions
```

Deploy all Python back-end functions

### ios cards

```sh
[bundle exec] fastlane ios cards
```

Deploy card-generation function

### ios research

```sh
[bundle exec] fastlane ios research
```

Deploy research-generation function

### ios data

```sh
[bundle exec] fastlane ios data
```

Deploy data-warehouse function

### ios restaurants

```sh
[bundle exec] fastlane ios restaurants
```

Deploy scan_restaurants function

### ios google_trends

```sh
[bundle exec] fastlane ios google_trends
```

Deploy scan_google_trends function

### ios books

```sh
[bundle exec] fastlane ios books
```

Deploy scan_book_lists function

### ios cinema

```sh
[bundle exec] fastlane ios cinema
```

Deploy scan_cinema function

### ios unified

```sh
[bundle exec] fastlane ios unified
```

Deploy unified scanning function

### ios search

```sh
[bundle exec] fastlane ios search
```

Deploy scan_custom_search function

### ios reports

```sh
[bundle exec] fastlane ios reports
```

Deploy Fastlane reports (card + user metrics)

### ios notifications

```sh
[bundle exec] fastlane ios notifications
```

Deploy notifications function

### ios ranking

```sh
[bundle exec] fastlane ios ranking
```

Deploy ranking profiles builder function

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Upload a new beta build to TestFlight

### ios appstore_manual

```sh
[bundle exec] fastlane ios appstore_manual
```

Upload a manual App Store release

### ios appstore_auto

```sh
[bundle exec] fastlane ios appstore_auto
```

Upload an automatic App Store release

### ios terminate

```sh
[bundle exec] fastlane ios terminate
```

Terminate Firebase emulators on common ports

### ios activate

```sh
[bundle exec] fastlane ios activate
```

Activate Python virtual environment

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
