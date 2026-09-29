import type { Flight } from './api';

const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const flightClock=(value:string)=>clock.format(new Date(value));
export function flightSegments(flight:Pick<Flight,'startsAt'|'endsAt'|'flightStartsAt'|'flightEndsAt'>){
  const briefEnd=flight.flightStartsAt && Date.parse(flight.flightStartsAt)>Date.parse(flight.startsAt)?flight.flightStartsAt:null;
  const flightStart=flight.flightStartsAt;
  const flightEnd=flight.flightEndsAt;
  const debriefStart=flightEnd && Date.parse(flight.endsAt)>Date.parse(flightEnd)?flightEnd:null;
  return {brief:{start:flight.startsAt,end:briefEnd},
    flight:flightStart||flightEnd?{start:flightStart,end:flightEnd}:null,
    debrief:debriefStart?{start:debriefStart,end:flight.endsAt}:null};
}
export function flightLessonLabels(flight:Pick<Flight,'plannedLessons'>){
  return (flight.plannedLessons??[]).map(lesson=>lesson.lectureName && lesson.lectureName!==lesson.trainingName
    ?`${lesson.trainingName} · ${lesson.lectureName}`:lesson.trainingName);
}
