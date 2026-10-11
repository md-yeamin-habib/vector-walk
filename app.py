import os
import math
import re
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder='static', static_url_path='')


def parse_natural_language_to_instructions(text):
  """Parses relative word problems into a queue of
  MOVE {distance} and TURN {RIGHT/LEFT} {degrees} instructions.
  """
  instructions = []
  clauses = re.split(r'\.\s+|\n|,|\band then\b|\bthen\b|\band\b', text, flags=re.IGNORECASE)

  # Cardinal and ordinal direction mapping to absolute angles in degrees (North = 90)
  cardinal_angles = {
      'northeast': 45,
      'northwest': 135,
      'southeast': 315,
      'southwest': 225,
      'north': 90,
      'east': 0,
      'south': 270,
      'west': 180,
  }

  current_heading_deg = 90  # Default start facing North

  for clause in clauses:
    clause = clause.strip()
    if not clause:
      continue

    lower_clause = clause.lower()

    # Check for absolute direction commands (order matters: check 2-word subdirections first)
    abs_dir_match = None
    for d_name in ['northeast', 'northwest', 'southeast', 'southwest', 'north', 'east', 'south', 'west']:
      if (
          f'face {d_name}' in lower_clause
          or f'facing {d_name}' in lower_clause
          or f'turn {d_name}' in lower_clause
          or f'turns {d_name}' in lower_clause
          or f'faced {d_name}' in lower_clause
      ):
        abs_dir_match = d_name
        break

    if abs_dir_match:
      target_deg = cardinal_angles[abs_dir_match]
      
      # Calculate the shortest relative turn from current heading to target absolute heading
      right_diff = (current_heading_deg - target_deg) % 360
      left_diff = (target_deg - current_heading_deg) % 360

      if right_diff <= left_diff:
        turn_dir = 'RIGHT'
        turn_deg = right_diff
      else:
        turn_dir = 'LEFT'
        turn_deg = left_diff

      if turn_deg > 0:
        instructions.append({'type': 'TURN', 'direction': turn_dir, 'value': float(turn_deg)})

      current_heading_deg = target_deg
      continue

    if any(phrase in lower_clause for phrase in ['about turn', 'about-turn', 'turn around', 'turns around', 'turned around', 'reverse']):
      instructions.append({'type': 'TURN', 'direction': 'RIGHT', 'value': 180})
      current_heading_deg = (current_heading_deg - 180) % 360
      continue

    if (
        'turn' in lower_clause
        or 'faced' in lower_clause
        or 'faces' in lower_clause      
        or 'facing' in lower_clause      
        or 'turns' in lower_clause
        or 'turned' in lower_clause
        or 'clockwise' in lower_clause
        or 'anticlockwise' in lower_clause
    ):
      turn_dir = (
          'LEFT'
          if (
              'left' in lower_clause
              or 'anticlockwise' in lower_clause
              or 'counter' in lower_clause
          )
          else 'RIGHT'
      )
      deg_match = re.search(r'(\d+(?:\.\d+)?)', lower_clause)
      deg = float(deg_match.group(1)) if deg_match else 90
      instructions.append({'type': 'TURN', 'direction': turn_dir, 'value': deg})
      
      if turn_dir == 'RIGHT':
        current_heading_deg = (current_heading_deg - deg) % 360
      else:
        current_heading_deg = (current_heading_deg + deg) % 360
      continue

    move_match = re.search(
        r'(?:move|walk|moved|walked|travel|travels|go|goes|ran|runs?|walks?|moves?)\s*(?:for\s*)?(\d+(?:\.\d+)?)',
        lower_clause,
    )
    if move_match:
      val = float(move_match.group(1))
      unit = 'km'
      if (
          'm' in lower_clause
          and 'km' not in lower_clause
          and 'meter' not in lower_clause
      ):
        unit = 'm'
      elif 'meter' in lower_clause and 'km' not in lower_clause:
        unit = 'm'
      instructions.append({'type': 'MOVE', 'value': val, 'unit': unit})
      continue

    num_match = re.search(r'(\d+(?:\.\d+)?)', lower_clause)
    if num_match and any(
        w in lower_clause for w in ['km', 'm', 'meter', 'meters', 'metres', 'kilometer', 'kilometers', 'kilometres', 'units', 'steps']
    ):
      val = float(num_match.group(1))
      unit = 'km'
      if (
          'm' in lower_clause
          and 'km' not in lower_clause
          and 'meter' not in lower_clause
      ):
        unit = 'm'
      elif 'meter' in lower_clause and 'km' not in lower_clause:
        unit = 'm'
      instructions.append({'type': 'MOVE', 'value': val, 'unit': unit})

  if not instructions:
    instructions = [
        {'type': 'MOVE', 'value': 4, 'unit': 'km'},
        {'type': 'TURN', 'direction': 'RIGHT', 'value': 90},
        {'type': 'MOVE', 'value': 3, 'unit': 'km'},
    ]

  return instructions


def compute_simulation(instructions):
  """Simulates route, computes Pythagoras displacement and tracks heading angles."""
  x, y = 0.0, 0.0
  start_pos = {'x': x, 'y': y}
  
  # Start facing North (+Y in mathematical space, angle = pi/2)
  current_angle = math.pi / 2  
  trail = [{'x': x, 'y': y, 'angle': current_angle, 'inst_index': 0}]
  total_distance_km = 0.0

  for idx, inst in enumerate(instructions):
    if inst['type'] == 'MOVE':
      val = inst['value']
      unit = inst.get('unit', 'km')
      dist_km = val / 1000.0 if unit == 'm' else val
      if dist_km > 0:
        total_distance_km += dist_km
        x += dist_km * math.cos(current_angle)
        y += dist_km * math.sin(current_angle)
        trail.append({'x': x, 'y': y, 'angle': current_angle, 'inst_index': idx})
    elif inst['type'] == 'TURN':
      deg = inst['value']
      rad = math.radians(deg)
      # RIGHT = Clockwise (decreases angle), LEFT = Counter-clockwise (increases angle)
      if inst['direction'] == 'RIGHT':
        current_angle -= rad
      else:
        current_angle += rad
      trail.append({'x': x, 'y': y, 'angle': current_angle, 'inst_index': idx})

  dx = x - start_pos['x']
  dy = y - start_pos['y']
  net_displacement_km = math.sqrt(dx**2 + dy**2)

  disp_angle = math.degrees(math.atan2(dy, dx)) % 360
  if disp_angle < 0:
    disp_angle += 360

  if 22.5 <= disp_angle < 67.5:
    disp_heading = 'Northeast'
  elif 67.5 <= disp_angle < 112.5:
    disp_heading = 'North'
  elif 112.5 <= disp_angle < 157.5:
    disp_heading = 'Northwest'
  elif 157.5 <= disp_angle < 202.5:
    disp_heading = 'West'
  elif 202.5 <= disp_angle < 247.5:
    disp_heading = 'Southwest'
  elif 247.5 <= disp_angle < 292.5:
    disp_heading = 'South'
  elif 292.5 <= disp_angle < 337.5:
    disp_heading = 'Southeast'
  else:
    disp_heading = 'East'

  return {
      'trail': trail,
      'final_position': {'x': x, 'y': y},
      'total_distance_km': total_distance_km,
      'net_displacement_km': net_displacement_km,
      'displacement_heading': disp_heading,
      'instructions': instructions,
  }


@app.route('/')
def index():
  return send_from_directory('static', 'index.html')


@app.route('/api/simulate', methods=['POST'])
def simulate():
  data = request.json or {}
  text_input = data.get(
      'text', 'John walks 400 m, turns right and walks 300 m.'
  )
  instructions = parse_natural_language_to_instructions(text_input)
  result = compute_simulation(instructions)
  return jsonify(result)


if __name__ == '__main__':
  port = int(os.environ.get('PORT', 8080))
  app.run(host='0.0.0.0', port=port)
