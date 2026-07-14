// The WebView shell needs a real device (platform channels), so it can't be
// pumped headlessly. Instead we test the pure-Dart update logic that gates
// whether the "Update available" banner appears.
import 'package:flutter_test/flutter_test.dart';

import 'package:foos/updater.dart';

void main() {
  group('Updater.isNewer', () {
    test('detects a higher patch/minor/major', () {
      expect(Updater.isNewer('0.1.1', '0.1.0'), isTrue);
      expect(Updater.isNewer('0.2.0', '0.1.9'), isTrue);
      expect(Updater.isNewer('1.0.0', '0.9.9'), isTrue);
    });

    test('is false for equal or older versions', () {
      expect(Updater.isNewer('0.1.0', '0.1.0'), isFalse);
      expect(Updater.isNewer('0.1.0', '0.1.1'), isFalse);
      expect(Updater.isNewer('0.9.9', '1.0.0'), isFalse);
    });

    test('ignores build metadata after +', () {
      expect(Updater.isNewer('0.1.0+5', '0.1.0+2'), isFalse);
    });
  });
}
