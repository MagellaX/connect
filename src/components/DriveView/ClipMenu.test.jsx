import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ClipMenu from './ClipMenu';
import { clipDevice } from '../../api/clips';
import { DIALOGS } from '../../url';

vi.mock('../../api/clips', () => ({
  clipDevice: {
    getClipState: vi.fn(), hasClipBlob: vi.fn(), getClipUrl: vi.fn(), deleteClip: vi.fn(),
  },
}));

const DONGLE = 'aaaaaaaaaaaaaaaa';
const clips = ['one.mp4', 'two.mp4'].map(filename => ({
  filename, status: 'ready', requested_at: 1, route: 'route', camera: 'fcamera.hevc',
  source_start_time: 0, source_end_time: 10, speedup: 1,
}));

function props(dialog, filename = null) {
  return {
    open: true, dialog, clipFilename: filename, dongleId: DONGLE,
    deviceOnline: true, inventoryOnly: true, routes: [], anchorEl: null,
    onClose: vi.fn(), onCloseChild: vi.fn(), onOpenViewer: vi.fn(), onOpenDelete: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clipDevice.getClipState.mockResolvedValue({ clips });
  clipDevice.hasClipBlob.mockResolvedValue(false);
  clipDevice.getClipUrl.mockResolvedValue('blob:clip');
  clipDevice.deleteClip.mockResolvedValue(null);
  URL.revokeObjectURL = vi.fn();
});

it('loads a clip viewer from a cold URL without requiring a menu click', async () => {
  render(<ClipMenu {...props(DIALOGS.CLIP_VIEWER, 'one.mp4')} />);
  await waitFor(() => expect(clipDevice.getClipUrl).toHaveBeenCalledWith(DONGLE, 'one.mp4', 1, expect.any(Function)));
  await waitFor(() => expect(screen.getByText('one')).toBeVisible());
  expect(screen.getByRole('button', { name: 'Close video' })).toBeVisible();
});

it('does not delete a clip merely because its confirmation URL was opened', async () => {
  const input = props(DIALOGS.CLIP_DELETE, 'one.mp4');
  render(<ClipMenu {...input} />);
  await screen.findByText('Delete clip?');
  expect(clipDevice.deleteClip).not.toHaveBeenCalled();
  const confirm = screen.getByRole('button', { name: 'Delete', exact: true });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(clipDevice.deleteClip).toHaveBeenCalledWith(DONGLE, { filename: 'one.mp4' }));
  await waitFor(() => expect(input.onCloseChild).toHaveBeenCalledOnce());
});

it('keeps an unknown clip link non-destructive and explains the missing target', async () => {
  render(<ClipMenu {...props(DIALOGS.CLIP_DELETE, 'missing.mp4')} />);
  expect(await screen.findByText('Clip not found on this device')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  expect(clipDevice.deleteClip).not.toHaveBeenCalled();
});

it('waits for a queued clip to become ready before fetching its video', async () => {
  clipDevice.getClipState.mockResolvedValueOnce({ clips: [{ ...clips[0], status: 'queued' }] });
  render(<ClipMenu {...props(DIALOGS.CLIP_VIEWER, 'one.mp4')} />);
  expect(await screen.findByText('Clip is not ready yet')).toBeVisible();
  expect(clipDevice.getClipUrl).not.toHaveBeenCalled();
});

it('discards a late preview after the URL targets a different clip', async () => {
  let finishFirst;
  clipDevice.getClipUrl.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce('blob:two');
  const input = props(DIALOGS.CLIP_VIEWER, 'one.mp4');
  const view = render(<ClipMenu {...input} />);
  await waitFor(() => expect(clipDevice.getClipUrl).toHaveBeenCalledTimes(1));
  view.rerender(<ClipMenu {...input} clipFilename="two.mp4" />);
  await waitFor(() => expect(clipDevice.getClipUrl).toHaveBeenCalledTimes(2));
  finishFirst('blob:one');
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one'));
  await waitFor(() => expect(screen.getByRole('dialog').querySelector('video')?.getAttribute('src')).toBe('blob:two'));
});

it('does not let an old deletion close a newer clip confirmation', async () => {
  let finishDelete;
  clipDevice.deleteClip.mockImplementationOnce(() => new Promise(resolve => { finishDelete = resolve; }));
  const input = props(DIALOGS.CLIP_DELETE, 'one.mp4');
  const view = render(<ClipMenu {...input} />);
  const confirm = screen.getByRole('button', { name: 'Delete', exact: true });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(clipDevice.deleteClip).toHaveBeenCalledOnce());
  view.rerender(<ClipMenu {...input} clipFilename="two.mp4" />);
  await waitFor(() => expect(confirm).toBeEnabled());
  finishDelete(null);
  await waitFor(() => expect(clipDevice.getClipState).toHaveBeenCalledTimes(2));
  expect(input.onCloseChild).not.toHaveBeenCalled();
});
