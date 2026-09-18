"use strict";

function qaEnableDragging(host, section, header, messaging) {
  let position = null, drag = null, frame = 0, pending = null, touched = false;
  const interactive = 'button, a, input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"])';
  function place(point) {
    const rect = section.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    position = {
      x: Math.max(0, Math.min(point.x, Math.max(0, width - rect.width))),
      y: Math.max(0, Math.min(point.y, Math.max(0, height - rect.height)))
    };
    host.style.setProperty('right', 'auto', 'important');
    host.style.setProperty('left', `${position.x}px`, 'important');
    host.style.setProperty('top', `${position.y}px`, 'important');
  }
  function reclamp() {
    const rect = host.getBoundingClientRect();
    place(position || {x:rect.left, y:rect.top});
  }
  function flush() {
    cancelAnimationFrame(frame); frame = 0;
    if (pending) {place(pending); pending = null;}
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    pending = {x:event.clientX - drag.dx, y:event.clientY - drag.dy};
    if (!frame) frame = requestAnimationFrame(flush);
  }
  function finish(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (event.type === 'pointerup') move(event);
    flush();
    const id = drag.id; drag = null;
    header.classList.remove('dragging');
    if (header.hasPointerCapture(id)) header.releasePointerCapture(id);
    messaging.send({type:'QA_SAVE_POSITION', position}).catch(() => {
      console.warn('[LearnFlow] Panel position could not be saved');
    });
  }
  header.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || drag || event.target.closest(interactive)) return;
    const rect = host.getBoundingClientRect();
    touched = true;
    drag = {id:event.pointerId, dx:event.clientX - rect.left, dy:event.clientY - rect.top};
    header.setPointerCapture(event.pointerId);
    header.classList.add('dragging');
    event.preventDefault();
  });
  header.addEventListener('pointermove', move);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) header.addEventListener(event, finish);
  window.addEventListener('resize', reclamp);
  new ResizeObserver(reclamp).observe(section);
  messaging.send({type:'QA_GET_POSITION'}).then(response => {
    const point = response?.position;
    if (!touched && point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      touched = true; place(point);
    }
  }).catch(() => {});
  reclamp();
  return {reclamp, hasPreferredPosition: () => touched};
}
