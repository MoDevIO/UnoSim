import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tutorDiagnosticFetch, bindTutorDiagnosticResponse, reportTutorGraphic } from '@/lib/tutor-diagnostics';
import { clearTutorReviewRuns } from '@/lib/tutor-review-store';
const events: Array<{stage:string;outcome:string;graphicsProfile?:string}> = [];
const listener=(event:Event)=>events.push((event as CustomEvent).detail);
beforeEach(()=>{clearTutorReviewRuns();events.length=0;localStorage.setItem('unoDebugMode','1');document.addEventListener('tutor-diagnostic',listener);});
afterEach(()=>{localStorage.clear();document.removeEventListener('tutor-diagnostic',listener);vi.unstubAllGlobals();});
it('correlates UML receipt, held and render events without image data',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({question:'Kontext?',graphicStatus:'provided',diagram:{profile:'uml1-classic-v1',kind:'activity',image:{svg:'PRIVATE_IMAGE',bytes:13,width:200,height:100}}})));
 const body=await(await tutorDiagnosticFetch('/api/tutor/question',{})).json();const question={...body};bindTutorDiagnosticResponse(body,question);
 reportTutorGraphic(question,{stage:'browser',outcome:'held',reason:'awaiting-continue'});
 reportTutorGraphic(question,{stage:'renderer',outcome:'rendered'});
 expect(events).toContainEqual(expect.objectContaining({stage:'browser',outcome:'received',graphicsProfile:'uml1-classic-v1'}));
 expect(events).toContainEqual(expect.objectContaining({stage:'browser',outcome:'held'}));
 expect(events).toContainEqual(expect.objectContaining({stage:'renderer',outcome:'rendered'}));
 expect(JSON.stringify(events)).not.toContain('PRIVATE_IMAGE');
 clearTutorReviewRuns();const length=events.length;reportTutorGraphic(question,{stage:'renderer',outcome:'rendered'});expect(events).toHaveLength(length);
});
it.each(['unavailable','not-useful'])('records that %s response has no image',async(graphicStatus)=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({question:'Kontext?',graphicStatus})));
 const body=await(await tutorDiagnosticFetch('/api/tutor/question',{})).json();bindTutorDiagnosticResponse(body,{...body});
 expect(events).toContainEqual(expect.objectContaining({stage:'browser',outcome:'not-provided'}));
});
