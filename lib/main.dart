import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:image_picker/image_picker.dart';

import 'theme.dart';
import 'updater.dart';

const String kHomeUrl = 'https://github.com';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: kBg,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: kBg,
    systemNavigationBarIconBrightness: Brightness.light,
  ));
  runApp(const OctoApp());
}

class OctoApp extends StatelessWidget {
  const OctoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Octo',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: kBg,
        colorScheme: const ColorScheme.dark(
          surface: kBg,
          primary: kAccent,
        ),
      ),
      home: const WebShell(),
    );
  }
}

class WebShell extends StatefulWidget {
  const WebShell({super.key});
  @override
  State<WebShell> createState() => _WebShellState();
}

class _WebShellState extends State<WebShell> {
  late final WebViewController _controller;
  bool _loading = true;
  ReleaseInfo? _pendingUpdate; // set when the launch-time check finds a newer build
  bool _bannerDismissed = false;

  @override
  void initState() {
    super.initState();

    final PlatformWebViewControllerCreationParams params =
        const PlatformWebViewControllerCreationParams();
    final WebViewController controller =
        WebViewController.fromPlatformCreationParams(params);

    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(kBg)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() => _loading = true);
        },
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onNavigationRequest: _handleNavigation,
      ))
      ..loadRequest(Uri.parse(kHomeUrl));

    // Android-specific tuning: cancel file pickers gracefully; allow media.
    if (controller.platform is AndroidWebViewController) {
      final AndroidWebViewController android =
          controller.platform as AndroidWebViewController;
      android.setOnShowFileSelector(_androidFilePicker);
      android.setMediaPlaybackRequiresUserGesture(false);
    }

    _controller = controller;

    // Quiet auto-check for an update; only surfaces a banner if one exists.
    _checkForUpdate();
  }

  Future<void> _checkForUpdate() async {
    try {
      final ReleaseInfo? r = await Updater.fetchLatest();
      if (r == null || !mounted) return;
      final String current = await Updater.currentVersion();
      if (Updater.isNewer(r.version, current)) {
        setState(() => _pendingUpdate = r);
      }
    } catch (_) {
      // Offline / rate-limited — silently ignore; user can long-press to check.
    }
  }

  // Keep GitHub (and its asset/CDN hosts + OAuth providers) inside the WebView;
  // push mailto:/tel:/downloads out to the system so they behave correctly.
  Future<NavigationDecision> _handleNavigation(NavigationRequest req) async {
    final Uri uri = Uri.parse(req.url);
    final String scheme = uri.scheme.toLowerCase();

    if (scheme == 'mailto' || scheme == 'tel' || scheme == 'intent') {
      await _openExternally(uri);
      return NavigationDecision.prevent;
    }

    // Direct downloads of release assets / archives → real browser.
    final String path = uri.path.toLowerCase();
    const List<String> downloadExt = <String>[
      '.apk', '.zip', '.tar.gz', '.tgz', '.gz', '.exe', '.dmg', '.deb',
      '.msi', '.jar', '.pdf', '.patch', '.diff'
    ];
    final bool looksLikeDownload = downloadExt.any(path.endsWith) ||
        path.contains('/releases/download/') ||
        uri.host.endsWith('objects.githubusercontent.com');
    if (looksLikeDownload) {
      await _openExternally(uri);
      return NavigationDecision.prevent;
    }

    return NavigationDecision.navigate;
  }

  Future<void> _openExternally(Uri uri) async {
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open that link.')),
        );
      }
    }
  }

  // GitHub upload forms (issue/PR attachments, avatar) trigger a file chooser.
  // Open the system photo picker and hand the chosen image URIs back to the
  // WebView — images/screenshots are the overwhelming GitHub-mobile upload
  // case. Returning an empty list = the user cancelled.
  final ImagePicker _picker = ImagePicker();

  Future<List<String>> _androidFilePicker(FileSelectorParams params) async {
    final bool multiple = params.mode == FileSelectorMode.openMultiple;
    try {
      if (multiple) {
        final List<XFile> files = await _picker.pickMultiImage();
        return files.map((XFile f) => Uri.file(f.path).toString()).toList();
      }
      final XFile? file = await _picker.pickImage(source: ImageSource.gallery);
      if (file == null) {
        return <String>[]; // cancelled
      }
      return <String>[Uri.file(file.path).toString()];
    } catch (_) {
      return <String>[];
    }
  }

  Future<bool> _onBack() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false; // handled — don't exit
    }
    return true; // at the root — allow the pop
  }

  void _openUpdateSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => UpdateSheet(preloaded: _pendingUpdate),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) async {
        if (didPop) return;
        final bool shouldPop = await _onBack();
        if (shouldPop && mounted) {
          SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: kBg,
        body: SafeArea(
          child: Column(
            children: <Widget>[
              if (_pendingUpdate != null && !_bannerDismissed)
                _UpdateBanner(
                  version: _pendingUpdate!.version,
                  onTap: _openUpdateSheet,
                  onDismiss: () => setState(() => _bannerDismissed = true),
                ),
              Expanded(
                child: Stack(
                  children: <Widget>[
                    RefreshIndicator(
                      color: kAccent,
                      backgroundColor: kCard,
                      onRefresh: () => _controller.reload(),
                      child: WebViewWidget(controller: _controller),
                    ),
                    // Long-press the very top edge to reach updates even when
                    // no banner is showing — the only hidden chrome.
                    Positioned(
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 24,
                      child: GestureDetector(
                        behavior: HitTestBehavior.translucent,
                        onLongPress: _openUpdateSheet,
                      ),
                    ),
                    if (_loading)
                      const Positioned(
                        top: 0,
                        left: 0,
                        right: 0,
                        child: LinearProgressIndicator(
                          minHeight: 2,
                          backgroundColor: Colors.transparent,
                          valueColor: AlwaysStoppedAnimation<Color>(kAccent),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _UpdateBanner extends StatelessWidget {
  final String version;
  final VoidCallback onTap;
  final VoidCallback onDismiss;
  const _UpdateBanner(
      {required this.version, required this.onTap, required this.onDismiss});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: kCard,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: kBorder)),
          ),
          child: Row(
            children: <Widget>[
              const Icon(Icons.system_update_alt_rounded,
                  size: 18, color: kAccent),
              const SizedBox(width: 10),
              Expanded(
                child: Text('Update available — v$version · tap to install',
                    style: const TextStyle(
                        fontSize: 13,
                        color: kInk,
                        fontWeight: FontWeight.w600)),
              ),
              GestureDetector(
                onTap: onDismiss,
                child: const Padding(
                  padding: EdgeInsets.all(4),
                  child: Icon(Icons.close_rounded, size: 18, color: kMuted),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
