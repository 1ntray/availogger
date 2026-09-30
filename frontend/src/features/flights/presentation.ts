import type { Flight } from './api';

const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const flightClock=(value:string)=>clock.format(new Date(value));
export function flightSegments(flight:Pick<Flight,'startsAt'|'endsAt'|'flightStartsAt'|'flightEndsAt'>){
  const flightStart=flight.flightStartsAt;
  const flightEnd=flight.flightEndsAt;
  const end=flightEnd && Date.parse(flight.endsAt)-Date.parse(flightEnd)>=60_000?flight.endsAt:null;
  return {brief:{start:flight.startsAt,end:null},
    flight:flightStart||flightEnd?{start:flightStart,end:flightEnd}:null,
    end:end?{start:end,end:null}:null};
}
export function flightLessonLabels(flight:Pick<Flight,'plannedLessons'>){
  return (flight.plannedLessons??[]).map(lesson=>lesson.lectureName && lesson.lectureName!==lesson.trainingName
    ?`${lesson.trainingName} · ${lesson.lectureName}`:lesson.trainingName);
}
