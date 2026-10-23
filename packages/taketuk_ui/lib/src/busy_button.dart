import 'package:flutter/material.dart';

/// A full-width primary button that runs an async action and stays disabled until it finishes,
/// so a double tap cannot send the same request twice (the API is idempotent as well).
class BusyButton extends StatefulWidget {
  const BusyButton({required this.label, required this.onPressed, super.key});

  final String label;

  /// Null disables the button.
  final Future<void> Function()? onPressed;

  @override
  State<BusyButton> createState() => _BusyButtonState();
}

class _BusyButtonState extends State<BusyButton> {
  bool _busy = false;

  Future<void> _run() async {
    setState(() => _busy = true);
    try {
      await widget.onPressed!();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => FilledButton(
    onPressed: widget.onPressed == null || _busy ? null : _run,
    child: _busy
        ? const SizedBox.square(
            dimension: 24,
            child: CircularProgressIndicator(strokeWidth: 3),
          )
        : Text(widget.label),
  );
}
