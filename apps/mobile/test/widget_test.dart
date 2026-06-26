import 'package:academiq_mobile/app.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('app boots and shows its title', (WidgetTester tester) async {
    await tester.pumpWidget(const AcademiqVideoApp());
    expect(find.text('AcademIQ Video'), findsOneWidget);
  });
}
