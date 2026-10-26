# Notifications
Two kinds, both off until the person allows them.

## Push
`registerForPush()` in `app/notifications/push.ts` sends the phone's token to `PUT /devices`, and `savePushToken()`
keeps it: one phone per person, the one they signed in on last.

## Best-before reminders
`remindExpiring()` picks the bought items whose best-before date is two days away or less, and schedules a reminder
at nine in the morning. They are scheduled on the phone itself, so they come offline too.
